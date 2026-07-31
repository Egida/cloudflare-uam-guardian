import { getConfigService } from './config';
import { logger } from './logger';
import { StateManager } from './state';
import { DiscordNotificationService } from './discord';
import { CloudflareService } from './cloudflare';
import { AttackDetector } from './detector';
import { GuardianScheduler } from './scheduler';
import { getSystemHealthMonitor } from './monitor';

async function bootstrap() {
  logger.info('Initializing Cloudflare Auto Under Attack Guardian...');

  const configService = getConfigService();
  const config = configService.getConfig();

  const stateManager = new StateManager(config.stateFilePath);
  const discordService = new DiscordNotificationService({
    webhookUrl: config.discordWebhookUrl,
  });

  const cfService = new CloudflareService({
    apiToken: config.cfApiToken,
    zoneId: config.cfZoneId,
  });

  const attackDetector = new AttackDetector(config);

  const scheduler = new GuardianScheduler(
    configService,
    cfService,
    stateManager,
    discordService,
    attackDetector
  );

  await discordService.notifyAppStarted({
    securityLevel: config.defaultSecurityLevel,
    reason: `Guardian daemon initialized. Monitoring interval: ${config.checkInterval}s.`,
  });

  try {
    const currentLevel = await cfService.getCurrentSecurityLevel();
    logger.info({ currentLevel }, 'Synced initial security level from Cloudflare.');
    const currentState = stateManager.getState();

    if (currentLevel === 'under_attack' && !currentState.isUnderAttack) {
      logger.warn('Cloudflare is in Under Attack Mode, but local state was false. Syncing state...');
      stateManager.updateState({
        isUnderAttack: true,
        enabledAt: Date.now(),
        lastAttackDetected: Date.now(),
        cooldownUntil: Date.now() + (config.cooldownMinutes * 60 * 1000)
      });
    } else if (currentLevel !== 'under_attack' && currentState.isUnderAttack) {
      logger.warn('Cloudflare is NOT in Under Attack Mode, but local state was true. Syncing state...');
      stateManager.updateState({ isUnderAttack: false });
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ error: errorMsg }, 'Failed to sync initial security level from Cloudflare.');
  }

  scheduler.start();

  if (config.localMonitoringEnabled) {
    const monitor = getSystemHealthMonitor();
    monitor.start();
  }

  let isShuttingDown = false;
  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, `Received ${signal}. Initiating graceful shutdown...`);
    try {
      if (config.localMonitoringEnabled) {
        getSystemHealthMonitor().stop();
      }
      await scheduler.stop(signal);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: errorMsg }, 'Error during graceful shutdown execution.');
    } finally {
      logger.info('Process exiting gracefully.');
      process.exit(0);
    }
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  process.on('uncaughtException', async (error: Error) => {
    logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught Exception in daemon process.');
    await discordService.notifyAppError(`Uncaught Exception: ${error.message}`);
    await handleShutdown('uncaughtException');
  });

  process.on('unhandledRejection', async (reason: unknown) => {
    const errorMsg = reason instanceof Error ? reason.message : String(reason);
    logger.fatal({ reason: errorMsg }, 'Unhandled Promise Rejection in daemon process.');
    await discordService.notifyAppError(`Unhandled Rejection: ${errorMsg}`);
    await handleShutdown('unhandledRejection');
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err: err.message }, 'Failed to bootstrap application.');
  process.exit(1);
});
