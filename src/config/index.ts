import * as dotenv from 'dotenv';
import { AppConfig, SecurityLevel } from '../types';

dotenv.config();

export class ConfigService {
  private readonly config: AppConfig;

  constructor(env: Record<string, string | undefined> = process.env) {
    const errors: string[] = [];

    const cfApiToken = env.CF_API_TOKEN?.trim();
    if (!cfApiToken) {
      errors.push('CF_API_TOKEN is required and cannot be empty.');
    }

    const cfZoneId = env.CF_ZONE_ID?.trim();
    if (!cfZoneId) {
      errors.push('CF_ZONE_ID is required and cannot be empty.');
    }

    const checkIntervalRaw = env.CHECK_INTERVAL;
    const checkInterval = checkIntervalRaw ? Number(checkIntervalRaw) : NaN;
    if (isNaN(checkInterval) || checkInterval <= 0) {
      errors.push(`CHECK_INTERVAL is required and must be a positive number in seconds (received: "${checkIntervalRaw}").`);
    }

    const enableThresholdRaw = env.ENABLE_THRESHOLD;
    const enableThreshold = enableThresholdRaw ? Number(enableThresholdRaw) : NaN;
    if (isNaN(enableThreshold) || enableThreshold <= 0) {
      errors.push(`ENABLE_THRESHOLD is required and must be a positive number (received: "${enableThresholdRaw}").`);
    }

    const disableThresholdRaw = env.DISABLE_THRESHOLD;
    const disableThreshold = disableThresholdRaw ? Number(disableThresholdRaw) : NaN;
    if (isNaN(disableThreshold) || disableThreshold < 0) {
      errors.push(`DISABLE_THRESHOLD is required and must be a non-negative number (received: "${disableThresholdRaw}").`);
    }

    if (!isNaN(enableThreshold) && !isNaN(disableThreshold) && disableThreshold > enableThreshold) {
      errors.push(`DISABLE_THRESHOLD (${disableThreshold}) cannot be greater than ENABLE_THRESHOLD (${enableThreshold}).`);
    }

    const cooldownMinutesRaw = env.COOLDOWN_MINUTES;
    const cooldownMinutes = cooldownMinutesRaw ? Number(cooldownMinutesRaw) : NaN;
    if (isNaN(cooldownMinutes) || cooldownMinutes < 0) {
      errors.push(`COOLDOWN_MINUTES is required and must be a non-negative number (received: "${cooldownMinutesRaw}").`);
    }

    const errorRateThresholdRaw = env.ERROR_RATE_THRESHOLD;
    const errorRateThreshold = errorRateThresholdRaw ? Number(errorRateThresholdRaw) : 5; // Default 5%
    if (isNaN(errorRateThreshold) || errorRateThreshold <= 0 || errorRateThreshold > 100) {
      errors.push(`ERROR_RATE_THRESHOLD must be a number between 1 and 100 (received: "${errorRateThresholdRaw}").`);
    }

    const localMonitoringEnabledRaw = env.LOCAL_MONITORING_ENABLED;
    const localMonitoringEnabled = localMonitoringEnabledRaw ? localMonitoringEnabledRaw.toLowerCase() === 'true' : true; // Default true

    const cpuThresholdRaw = env.CPU_THRESHOLD;
    const cpuThreshold = cpuThresholdRaw ? Number(cpuThresholdRaw) : 90; // Default 90%
    if (isNaN(cpuThreshold) || cpuThreshold <= 0 || cpuThreshold > 100) {
      errors.push(`CPU_THRESHOLD must be a number between 1 and 100 (received: "${cpuThresholdRaw}").`);
    }

    const validSecurityLevels: SecurityLevel[] = ['off', 'essentially_off', 'low', 'medium', 'high'];
    const defaultSecurityLevelRaw = env.DEFAULT_SECURITY_LEVEL?.trim() as SecurityLevel;
    if (!defaultSecurityLevelRaw || !validSecurityLevels.includes(defaultSecurityLevelRaw)) {
      errors.push(
        `DEFAULT_SECURITY_LEVEL is required and must be one of: ${validSecurityLevels.join(', ')} (received: "${env.DEFAULT_SECURITY_LEVEL}").`
      );
    }

    const discordWebhookUrl = env.DISCORD_WEBHOOK_URL?.trim();
    if (discordWebhookUrl && !this.isValidUrl(discordWebhookUrl)) {
      errors.push(`DISCORD_WEBHOOK_URL must be a valid HTTP/HTTPS URL (received: "${discordWebhookUrl}").`);
    }

    const validLogLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
    const logLevel = (env.LOG_LEVEL?.trim() || 'info').toLowerCase();
    if (!validLogLevels.includes(logLevel)) {
      errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')} (received: "${env.LOG_LEVEL}").`);
    }

    const stateFilePath = env.STATE_FILE_PATH?.trim() || './uam-state.json';

    if (errors.length > 0) {
      const errorMessage = `[ConfigService Validation Error]\n- ` + errors.join('\n- ');
      throw new Error(errorMessage);
    }

    this.config = {
      cfApiToken: cfApiToken!,
      cfZoneId: cfZoneId!,
      checkInterval,
      enableThreshold,
      disableThreshold,
      cooldownMinutes,
      defaultSecurityLevel: defaultSecurityLevelRaw,
      discordWebhookUrl: discordWebhookUrl || undefined,
      logLevel,
      stateFilePath,
      errorRateThreshold,
      localMonitoringEnabled,
      cpuThreshold,
    };
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  public get cfApiToken(): string {
    return this.config.cfApiToken;
  }

  public get cfZoneId(): string {
    return this.config.cfZoneId;
  }

  public get checkInterval(): number {
    return this.config.checkInterval;
  }

  public get enableThreshold(): number {
    return this.config.enableThreshold;
  }

  public get disableThreshold(): number {
    return this.config.disableThreshold;
  }

  public get cooldownMinutes(): number {
    return this.config.cooldownMinutes;
  }

  public get defaultSecurityLevel(): SecurityLevel {
    return this.config.defaultSecurityLevel;
  }

  public get discordWebhookUrl(): string | undefined {
    return this.config.discordWebhookUrl;
  }

  public get logLevel(): string {
    return this.config.logLevel;
  }

  public get stateFilePath(): string {
    return this.config.stateFilePath;
  }

  public get errorRateThreshold(): number {
    return this.config.errorRateThreshold;
  }

  public get localMonitoringEnabled(): boolean {
    return this.config.localMonitoringEnabled;
  }

  public get cpuThreshold(): number {
    return this.config.cpuThreshold;
  }
}

let instance: ConfigService | null = null;
export function getConfigService(): ConfigService {
  if (!instance) {
    instance = new ConfigService();
  }
  return instance;
}
