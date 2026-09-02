import { CloudflareService } from '../cloudflare';
import { ConfigService } from '../config';
import { AttackDetector } from '../detector';
import { DiscordNotificationService } from '../discord';
import { logger } from '../logger';
import { StateManager } from '../state';
import { TrafficMetrics } from '../detector/detector.types';
import { getSystemHealthMonitor } from '../monitor';
import { AppState, GuardianStatistics } from '../types';
import { Logger } from 'pino';

export class GuardianScheduler {
  private readonly configService: ConfigService;
  private readonly cfService: CloudflareService;
  private readonly stateManager: StateManager;
  private readonly discordService: DiscordNotificationService;
  private readonly detector: AttackDetector;
  private isRunning: boolean = false;
  private isProcessing: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private tickCounter: number = 0;
  private consecutiveApiFailures: number = 0;
  private cachedSecurityLevel: string | null = null;
  private lastSecurityLevelSyncAt: number = 0;
  private readonly securityLevelCacheTtlMs: number = 60_000; 
  private lastHeartbeatAt: number = 0;
  private readonly stats: GuardianStatistics;
  private tickLatencies: number[] = [];
  private readonly maxLatencyHistory: number = 100;

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

    this.stats = {
      startedAt: Date.now(),
      totalTicks: 0,
      successfulTicks: 0,
      failedTicks: 0,
      consecutiveApiFailures: 0,
      totalUamActivations: 0,
      totalUamDeactivations: 0,
      lastSuccessfulTickAt: null,
      lastFailedTickAt: null,
      averageTickLatencyMs: 0,
    };
  }

  public start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler is already running. Duplicate start ignored.');
      return;
    }

    this.isRunning = true;
    this.lastHeartbeatAt = Date.now();
    const config = this.configService.getConfig();

    logger.info(
      {
        intervalSec: config.checkInterval,
        heartbeatIntervalMin: config.heartbeatIntervalMinutes,
        maxConsecutiveApiFailures: config.maxConsecutiveApiFailures,
        failSafeMode: 'ENABLED',
      },
      'Starting Guardian Scheduler (government-grade hardened mode)...'
    );

    this.scheduleNextTick(0);
  }

  public async stop(signal: string): Promise<void> {
    if (!this.isRunning) return;

    logger.info({ signal, stats: this.getStatsSummary() }, 'Stopping Guardian Scheduler gracefully...');
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
    this.tickCounter++;
    this.stats.totalTicks++;

    const tickId = `tick-${this.tickCounter}`;
    const tickStartMs = Date.now();
    const config = this.configService.getConfig();

    const tickLog = logger.child({ tickId, tickNum: this.tickCounter });

    try {
      tickLog.debug('Executing scheduler tick...');

      const metricsResult = await this.cfService.getTrafficMetrics();

      if (metricsResult === null) {
        this.consecutiveApiFailures++;
        this.stats.consecutiveApiFailures = this.consecutiveApiFailures;
        this.stats.failedTicks++;
        this.stats.lastFailedTickAt = Date.now();

        tickLog.warn(
          {
            consecutiveApiFailures: this.consecutiveApiFailures,
            maxAllowed: config.maxConsecutiveApiFailures,
            currentState: this.stateManager.getState().isUnderAttack ? 'UNDER_ATTACK' : 'NORMAL',
          },
          'FAIL-SAFE: Traffic metrics unavailable. Preserving current state — will NOT make any UAM changes.'
        );

        if (this.consecutiveApiFailures === config.maxConsecutiveApiFailures) {
          tickLog.error(
            { consecutiveApiFailures: this.consecutiveApiFailures },
            `CRITICAL: ${this.consecutiveApiFailures} consecutive API failures reached threshold. Alerting operations team.`
          );
          await this.discordService.notifyAppError(
            `CRITICAL: Cloudflare API has failed ${this.consecutiveApiFailures} times consecutively. ` +
            `Guardian is in FAIL-SAFE mode — current UAM state is being preserved but no new decisions can be made. ` +
            `Investigate API connectivity and token validity immediately.`
          );
        }

        this.stateManager.updateState({
          lastDecision: `FAIL_SAFE_API_UNAVAILABLE_${this.consecutiveApiFailures}`,
        });

        return;
      }

      if (this.consecutiveApiFailures > 0) {
        tickLog.info(
          { previousConsecutiveFailures: this.consecutiveApiFailures },
          'API connectivity restored after consecutive failures.'
        );
      }
      this.consecutiveApiFailures = 0;
      this.stats.consecutiveApiFailures = 0;
      this.stats.successfulTicks++;
      this.stats.lastSuccessfulTickAt = Date.now();

      const { rps, errorRate, latencyMs: apiLatencyMs } = metricsResult;

      const cpuUsage = config.localMonitoringEnabled ? getSystemHealthMonitor().getAverageCpuUsage() : 0;

      const metrics: TrafficMetrics = {
        rps,
        errorRate,
        cpuUsage,
        timestamp: Date.now(),
      };

      const detectionResult = this.detector.evaluate(metrics);

      const now = Date.now();
      const needsSecurityLevelSync =
        this.cachedSecurityLevel === null ||
        (now - this.lastSecurityLevelSyncAt) > this.securityLevelCacheTtlMs;

      if (needsSecurityLevelSync) {
        try {
          this.cachedSecurityLevel = await this.cfService.getCurrentSecurityLevel();
          this.lastSecurityLevelSyncAt = now;
          tickLog.debug({ cachedSecurityLevel: this.cachedSecurityLevel }, 'Security level synced from Cloudflare.');
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          tickLog.warn(
            { error: errorMsg, cachedSecurityLevel: this.cachedSecurityLevel },
            'Failed to sync security level from Cloudflare. Using cached value.'
          );
        }
      }

      const isCloudflareUnderAttack = this.cachedSecurityLevel === 'under_attack';

      let state = this.stateManager.getState();

      if (isCloudflareUnderAttack && !state.isUnderAttack) {
        tickLog.warn(
          { cfLevel: this.cachedSecurityLevel, localState: state.isUnderAttack },
          'UAM detected as ENABLED on Cloudflare (External Change). Syncing state...'
        );
        const oldState = { ...state };
        state = this.stateManager.updateState({
          isUnderAttack: true,
          enabledAt: now,
          lastAttackDetected: now,
          cooldownUntil: now + (config.cooldownMinutes * 60 * 1000),
          lastDecision: 'EXTERNAL_ENABLE_SYNC',
        });
        this.logStateTransition(tickLog, 'EXTERNAL_ENABLE_SYNC', oldState, state);
      } else if (!isCloudflareUnderAttack && state.isUnderAttack) {
        tickLog.warn(
          { cfLevel: this.cachedSecurityLevel, localState: state.isUnderAttack },
          'UAM detected as DISABLED on Cloudflare (External Change). Syncing state...'
        );
        const oldState = { ...state };
        state = this.stateManager.updateState({
          isUnderAttack: false,
          enabledAt: null,
          cooldownUntil: null,
          lastDecision: 'EXTERNAL_DISABLE_SYNC',
        });
        this.logStateTransition(tickLog, 'EXTERNAL_DISABLE_SYNC', oldState, state);
      }

      tickLog.info(
        {
          rps,
          errorRate: `${errorRate.toFixed(2)}%`,
          cpuUsage: `${cpuUsage.toFixed(1)}%`,
          status: detectionResult.status,
          score: detectionResult.totalScore,
          isUnderAttack: state.isUnderAttack,
          apiLatencyMs,
        },
        'Evaluated traffic state'
      );

      if (detectionResult.status !== 'NORMAL') {
        tickLog.info(
          { reasons: detectionResult.reasons, score: detectionResult.totalScore },
          `Detection rules detail (${detectionResult.status})`
        );
      }

      if (detectionResult.status === 'ATTACK') {
        const cooldownUntil = now + config.cooldownMinutes * 60 * 1000;

        if (!state.isUnderAttack) {
          tickLog.warn(
            { rps, threshold: config.enableThreshold, score: detectionResult.totalScore },
            'Attack detected! Enabling Under Attack Mode...'
          );

          const newLevel = await this.cfService.enableUnderAttackMode();
          this.cachedSecurityLevel = newLevel; 

          const oldState = { ...state };
          this.stateManager.updateState({
            isUnderAttack: true,
            enabledAt: now,
            lastAttackDetected: now,
            cooldownUntil,
            lastDecision: 'ENABLED_UAM',
          });
          this.stats.totalUamActivations++;
          this.logStateTransition(tickLog, 'ENABLED_UAM', oldState, this.stateManager.getState());

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
          tickLog.info(
            { rps, score: detectionResult.totalScore, cooldownExtendedUntil: new Date(cooldownUntil).toISOString() },
            'Attack ongoing. Refreshing attack timestamp and cooldown.'
          );
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
            tickLog.info(
              { defaultLevel: config.defaultSecurityLevel, attackDurationMs: state.enabledAt ? now - state.enabledAt : 'unknown' },
              'Traffic normalized and cooldown complete. Disabling UAM...'
            );

            const newLevel = await this.cfService.disableUnderAttackMode(config.defaultSecurityLevel);
            this.cachedSecurityLevel = newLevel; // Update cache immediately

            const oldState = { ...state };
            this.stateManager.updateState({
              isUnderAttack: false,
              enabledAt: null,
              cooldownUntil: null,
              lastDecision: 'DISABLED_UAM',
            });
            this.stats.totalUamDeactivations++;
            this.logStateTransition(tickLog, 'DISABLED_UAM', oldState, this.stateManager.getState());

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
            tickLog.info(
              { remainingSec, cooldownUntil: new Date(cooldownUntil).toISOString() },
              'Traffic below threshold, waiting for cooldown to complete.'
            );

            this.stateManager.updateState({
              lastDecision: `WAITING_COOLDOWN_${remainingSec}S`,
            });
          }
        } else {
          tickLog.debug({ rps, score: detectionResult.totalScore }, 'Traffic normal and UAM disabled. Idle tick.');
          this.stateManager.updateState({
            lastDecision: 'NORMAL_IDLE',
          });
        }
      }

      this.emitHeartbeatIfDue(tickLog, config.heartbeatIntervalMinutes);

    } catch (err: unknown) {
      this.stats.failedTicks++;
      this.stats.lastFailedTickAt = Date.now();
      const errorMsg = err instanceof Error ? err.message : String(err);
      tickLog.error({ error: errorMsg }, 'Error during scheduler tick processing.');

      const isNetworkError = errorMsg.toLowerCase().includes('timeout') ||
                             errorMsg.toLowerCase().includes('econnreset') ||
                             errorMsg.toLowerCase().includes('network');

      if (!isNetworkError) {
        await this.discordService.notifyAppError(errorMsg);
      }
    } finally {
      const tickDurationMs = Date.now() - tickStartMs;
      this.tickLatencies.push(tickDurationMs);
      if (this.tickLatencies.length > this.maxLatencyHistory) {
        this.tickLatencies.shift();
      }
      this.stats.averageTickLatencyMs = this.tickLatencies.length > 0
        ? Math.round(this.tickLatencies.reduce((a, b) => a + b, 0) / this.tickLatencies.length)
        : 0;

      this.isProcessing = false;
    }
  }

  private logStateTransition(
    tickLog: Logger,
    action: string,
    oldState: Readonly<AppState>,
    newState: Readonly<AppState>
  ): void {
    tickLog.info(
      {
        action,
        transition: {
          isUnderAttack: { from: oldState.isUnderAttack, to: newState.isUnderAttack },
          enabledAt: { from: oldState.enabledAt, to: newState.enabledAt },
          cooldownUntil: {
            from: oldState.cooldownUntil ? new Date(oldState.cooldownUntil).toISOString() : null,
            to: newState.cooldownUntil ? new Date(newState.cooldownUntil).toISOString() : null,
          },
          lastDecision: { from: oldState.lastDecision, to: newState.lastDecision },
        },
      },
      `STATE TRANSITION: ${action}`
    );
  }

  private emitHeartbeatIfDue(tickLog: Logger, intervalMinutes: number): void {
    const now = Date.now();
    const intervalMs = intervalMinutes * 60 * 1000;

    if (now - this.lastHeartbeatAt < intervalMs) return;

    this.lastHeartbeatAt = now;
    const summary = this.getStatsSummary();

    tickLog.info(
      { heartbeat: true, ...summary },
      `HEARTBEAT: Guardian daemon is alive. Uptime: ${summary.uptimeFormatted}. Ticks: ${summary.totalTicks} (${summary.successfulTicks} ok, ${summary.failedTicks} failed). UAM activations: ${summary.totalUamActivations}.`
    );
  }

  private getStatsSummary(): GuardianStatistics & { uptimeFormatted: string } {
    const uptimeMs = Date.now() - this.stats.startedAt;
    const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const uptimeFormatted = `${uptimeHours}h ${uptimeMinutes}m`;

    return {
      ...this.stats,
      uptimeFormatted,
    };
  }
}
