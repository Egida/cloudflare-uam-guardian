import { CloudflareService } from '../cloudflare';
import { ConfigService } from '../config';
import { AttackDetector } from '../detector';
import { DiscordNotificationService } from '../discord';
import { logger } from '../logger';
import { StateManager } from '../state';
import { TrafficMetrics } from '../detector/detector.types';
import { getSystemHealthMonitor } from '../monitor';

export class GuardianScheduler {
  private readonly configService: ConfigService;
  private readonly cfService: CloudflareService;
  private readonly stateManager: StateManager;
  private readonly discordService: DiscordNotificationService;
  private readonly detector: AttackDetector;

  private isRunning: boolean = false;
  private isProcessing: boolean = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    configService: ConfigService,
    cfService: CloudflareService,
    stateManager: StateManager,
    discordService: DiscordNotificationService,
    detector: AttackDetector
  ) {
    this.configService = configService;
    this.cfService = cfService;
    this.stateManager = stateManager;
    this.discordService = discordService;
    this.detector = detector;
  }

  public start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler is already running. Duplicate start ignored.');
      return;
    }

    this.isRunning = true;
    const config = this.configService.getConfig();

    logger.info({ intervalSec: config.checkInterval }, 'Starting Guardian Scheduler...');

    this.scheduleNextTick(0);
  }

  public async stop(signal: string): Promise<void> {
    if (!this.isRunning) return;

    logger.info({ signal }, 'Stopping Guardian Scheduler gracefully...');
    this.isRunning = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    let waitCount = 0;
    while (this.isProcessing && waitCount < 10) {
      logger.info('Waiting for active tick to complete...');
      await new Promise((res) => setTimeout(res, 500));
      waitCount++;
    }

    logger.info('Saving state before process exit...');
    this.stateManager.saveState();
    logger.info('Guardian Scheduler stopped cleanly.');
  }

  private scheduleNextTick(delayMs?: number): void {
    if (!this.isRunning) return;

    const intervalMs = delayMs ?? this.configService.getConfig().checkInterval * 1000;
    this.timer = setTimeout(() => {
      this.tick()
        .catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error({ error: errorMsg }, 'Unhandled error in scheduler tick.');
        })
        .finally(() => {
          if (this.isRunning) {
            this.scheduleNextTick();
          }
        });
    }, intervalMs);
  }

  public async tick(): Promise<void> {
    if (this.isProcessing) {
      logger.warn('Previous tick still in progress. Skipping duplicate tick execution.');
      return;
    }

    this.isProcessing = true;
    const config = this.configService.getConfig();

    try {
      logger.debug('Executing scheduler tick...');

      const { rps, errorRate } = await this.cfService.getTrafficMetrics();
      const cpuUsage = config.localMonitoringEnabled ? getSystemHealthMonitor().getAverageCpuUsage() : 0;

      const metrics: TrafficMetrics = {
        rps,
        errorRate,
        cpuUsage,
        timestamp: Date.now(),
      };

      const detectionResult = this.detector.evaluate(metrics);
      const currentSecurityLevel = await this.cfService.getCurrentSecurityLevel();
      const isCloudflareUnderAttack = currentSecurityLevel === 'under_attack';

      let state = this.stateManager.getState();
      const now = Date.now();

      // Sinkronisasi otomatis jika diubah secara manual dari luar (misal: via PHP atau Dashboard)
      if (isCloudflareUnderAttack && !state.isUnderAttack) {
        logger.warn('UAM detected as ENABLED on Cloudflare (External Change). Syncing state...');
        state = this.stateManager.updateState({
          isUnderAttack: true,
          enabledAt: now,
          lastAttackDetected: now,
          cooldownUntil: now + (config.cooldownMinutes * 60 * 1000),
          lastDecision: 'EXTERNAL_ENABLE_SYNC',
        });
      } else if (!isCloudflareUnderAttack && state.isUnderAttack) {
        logger.warn('UAM detected as DISABLED on Cloudflare (External Change). Syncing state...');
        state = this.stateManager.updateState({
          isUnderAttack: false,
          enabledAt: null,
          cooldownUntil: null,
          lastDecision: 'EXTERNAL_DISABLE_SYNC',
        });
      }

      logger.info(
        {
          rps,
          errorRate: `${errorRate.toFixed(2)}%`,
          cpuUsage: `${cpuUsage.toFixed(1)}%`,
          status: detectionResult.status,
          score: detectionResult.totalScore,
          isUnderAttack: state.isUnderAttack
        },
        'Evaluated traffic state'
      );

      if (detectionResult.status === 'ATTACK') {
        const cooldownUntil = now + config.cooldownMinutes * 60 * 1000;

        if (!state.isUnderAttack) {
          logger.warn({ rps, threshold: config.enableThreshold }, 'Attack detected! Enabling Under Attack Mode...');

          const newLevel = await this.cfService.enableUnderAttackMode();

          this.stateManager.updateState({
            isUnderAttack: true,
            enabledAt: now,
            lastAttackDetected: now,
            cooldownUntil,
            lastDecision: 'ENABLED_UAM',
          });

          await this.discordService.notifyAttackStarted({
            status: 'UNDER_ATTACK',
            reason: detectionResult.reasons.join('\n'),
            requestCount: rps,
            errorRate,
            cpuUsage,
            securityLevel: newLevel,
            currentScore: detectionResult.totalScore,
          });
        } else {
          logger.info('Attack ongoing. Refreshing attack timestamp and cooldown.');
          this.stateManager.updateState({
            lastAttackDetected: now,
            cooldownUntil,
            lastDecision: 'ATTACK_ONGOING',
          });
        }
      } else {
        if (state.isUnderAttack) {
          const cooldownUntil = state.cooldownUntil ?? 0;
          const isCooldownFinished = now >= cooldownUntil;

          if (isCooldownFinished) {
            logger.info({ defaultLevel: config.defaultSecurityLevel }, 'Traffic normalized and cooldown complete. Disabling UAM...');

            const newLevel = await this.cfService.disableUnderAttackMode(config.defaultSecurityLevel);

            this.stateManager.updateState({
              isUnderAttack: false,
              enabledAt: null,
              cooldownUntil: null,
              lastDecision: 'DISABLED_UAM',
            });

            await this.discordService.notifyAttackStopped({
              status: 'NORMAL',
              reason: `Traffic normalized (${rps} RPS, ${errorRate.toFixed(2)}% Error, ${cpuUsage.toFixed(1)}% CPU) and cooldown of ${config.cooldownMinutes} minutes completed.`,
              requestCount: rps,
              errorRate,
              cpuUsage,
              securityLevel: newLevel,
              currentScore: detectionResult.totalScore,
            });
          } else {
            const remainingSec = Math.ceil((cooldownUntil - now) / 1000);
            logger.info({ remainingSec }, 'Traffic below threshold, waiting for cooldown to complete.');

            this.stateManager.updateState({
              lastDecision: `WAITING_COOLDOWN_${remainingSec}S`,
            });
          }
        } else {
          logger.debug('Traffic normal and UAM disabled. Idle tick.');
          this.stateManager.updateState({
            lastDecision: 'NORMAL_IDLE',
          });
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: errorMsg }, 'Error during scheduler tick processing.');
      
      // Jangan ganggu user dengan notifikasi Discord jika hanya error koneksi/timeout sesaat
      const isNetworkError = errorMsg.toLowerCase().includes('timeout') || 
                             errorMsg.toLowerCase().includes('econnreset') ||
                             errorMsg.toLowerCase().includes('network');
                             
      if (!isNetworkError) {
        await this.discordService.notifyAppError(errorMsg);
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
