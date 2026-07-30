import { getConfigService } from './config';
import { logger } from './logger';
import { StateManager } from './state';
import { DiscordNotifier } from './discord';
import { CloudflareClient } from './cloudflare';
import { TrafficDetector } from './detector';
async function bootstrap() {
    logger.info('Initializing Cloudflare Auto Under Attack Guardian...');
    // Initialize and validate configuration (fails fast if invalid)
    const configService = getConfigService();
    const config = configService.getConfig();
    // Dependency Injection initialization
    const stateManager = new StateManager(config.stateFilePath);
    const discordNotifier = new DiscordNotifier(config.discordWebhookUrl);
    const cfClient = new CloudflareClient(config.cfApiToken, config.cfZoneId);
    const detector = new TrafficDetector(config, cfClient, stateManager, discordNotifier);
    let isRunning = true;
    let timer = null;
    const loop = async () => {
        if (!isRunning)
            return;
        try {
            await detector.evaluate();
        }
        catch (err) {
            logger.error({ err: err.message }, 'Fatal error in daemon loop');
        }
        if (isRunning) {
            timer = setTimeout(loop, config.checkInterval * 1000);
        }
    };
    // Start the daemon loop
    loop();
    // Graceful Shutdown handling
    const shutdown = (signal) => {
        logger.info(`Received ${signal}. Starting graceful shutdown...`);
        isRunning = false;
        if (timer) {
            clearTimeout(timer);
        }
        // Persist final state
        logger.info('Saving state before exit...');
        stateManager.saveState();
        logger.info('Shutdown complete.');
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    logger.info(`Daemon started successfully. Interval: ${config.checkInterval}s`);
}
bootstrap().catch((err) => {
    logger.fatal({ err: err.message }, 'Failed to bootstrap application');
    process.exit(1);
});
