import * as dotenv from 'dotenv';
dotenv.config();
export class ConfigService {
    config;
    constructor(env = process.env) {
        const errors = [];
        // CF_API_TOKEN (Required)
        const cfApiToken = env.CF_API_TOKEN?.trim();
        if (!cfApiToken) {
            errors.push('CF_API_TOKEN is required and cannot be empty.');
        }
        // CF_ZONE_ID (Required)
        const cfZoneId = env.CF_ZONE_ID?.trim();
        if (!cfZoneId) {
            errors.push('CF_ZONE_ID is required and cannot be empty.');
        }
        // CHECK_INTERVAL (Required / Positive integer in seconds)
        const checkIntervalRaw = env.CHECK_INTERVAL;
        const checkInterval = checkIntervalRaw ? Number(checkIntervalRaw) : NaN;
        if (isNaN(checkInterval) || checkInterval <= 0) {
            errors.push(`CHECK_INTERVAL is required and must be a positive number in seconds (received: "${checkIntervalRaw}").`);
        }
        // ENABLE_THRESHOLD (Required / Positive number)
        const enableThresholdRaw = env.ENABLE_THRESHOLD;
        const enableThreshold = enableThresholdRaw ? Number(enableThresholdRaw) : NaN;
        if (isNaN(enableThreshold) || enableThreshold <= 0) {
            errors.push(`ENABLE_THRESHOLD is required and must be a positive number (received: "${enableThresholdRaw}").`);
        }
        // DISABLE_THRESHOLD (Required / Non-negative number)
        const disableThresholdRaw = env.DISABLE_THRESHOLD;
        const disableThreshold = disableThresholdRaw ? Number(disableThresholdRaw) : NaN;
        if (isNaN(disableThreshold) || disableThreshold < 0) {
            errors.push(`DISABLE_THRESHOLD is required and must be a non-negative number (received: "${disableThresholdRaw}").`);
        }
        if (!isNaN(enableThreshold) && !isNaN(disableThreshold) && disableThreshold > enableThreshold) {
            errors.push(`DISABLE_THRESHOLD (${disableThreshold}) cannot be greater than ENABLE_THRESHOLD (${enableThreshold}).`);
        }
        // COOLDOWN_MINUTES (Required / Non-negative number)
        const cooldownMinutesRaw = env.COOLDOWN_MINUTES;
        const cooldownMinutes = cooldownMinutesRaw ? Number(cooldownMinutesRaw) : NaN;
        if (isNaN(cooldownMinutes) || cooldownMinutes < 0) {
            errors.push(`COOLDOWN_MINUTES is required and must be a non-negative number (received: "${cooldownMinutesRaw}").`);
        }
        // DEFAULT_SECURITY_LEVEL (Required / Valid enum)
        const validSecurityLevels = ['off', 'essentially_off', 'low', 'medium', 'high'];
        const defaultSecurityLevelRaw = env.DEFAULT_SECURITY_LEVEL?.trim();
        if (!defaultSecurityLevelRaw || !validSecurityLevels.includes(defaultSecurityLevelRaw)) {
            errors.push(`DEFAULT_SECURITY_LEVEL is required and must be one of: ${validSecurityLevels.join(', ')} (received: "${env.DEFAULT_SECURITY_LEVEL}").`);
        }
        // DISCORD_WEBHOOK_URL (Optional / Valid URL if provided)
        const discordWebhookUrl = env.DISCORD_WEBHOOK_URL?.trim();
        if (discordWebhookUrl && !this.isValidUrl(discordWebhookUrl)) {
            errors.push(`DISCORD_WEBHOOK_URL must be a valid HTTP/HTTPS URL (received: "${discordWebhookUrl}").`);
        }
        // LOG_LEVEL (Optional / Valid pino level, default: 'info')
        const validLogLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
        const logLevel = (env.LOG_LEVEL?.trim() || 'info').toLowerCase();
        if (!validLogLevels.includes(logLevel)) {
            errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')} (received: "${env.LOG_LEVEL}").`);
        }
        // STATE_FILE_PATH
        const stateFilePath = env.STATE_FILE_PATH?.trim() || './uam-state.json';
        if (errors.length > 0) {
            const errorMessage = `[ConfigService Validation Error]\n- ` + errors.join('\n- ');
            throw new Error(errorMessage);
        }
        this.config = {
            cfApiToken: cfApiToken,
            cfZoneId: cfZoneId,
            checkInterval,
            enableThreshold,
            disableThreshold,
            cooldownMinutes,
            defaultSecurityLevel: defaultSecurityLevelRaw,
            discordWebhookUrl: discordWebhookUrl || undefined,
            logLevel,
            stateFilePath,
        };
    }
    isValidUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        }
        catch {
            return false;
        }
    }
    getConfig() {
        return this.config;
    }
    get cfApiToken() {
        return this.config.cfApiToken;
    }
    get cfZoneId() {
        return this.config.cfZoneId;
    }
    get checkInterval() {
        return this.config.checkInterval;
    }
    get enableThreshold() {
        return this.config.enableThreshold;
    }
    get disableThreshold() {
        return this.config.disableThreshold;
    }
    get cooldownMinutes() {
        return this.config.cooldownMinutes;
    }
    get defaultSecurityLevel() {
        return this.config.defaultSecurityLevel;
    }
    get discordWebhookUrl() {
        return this.config.discordWebhookUrl;
    }
    get logLevel() {
        return this.config.logLevel;
    }
    get stateFilePath() {
        return this.config.stateFilePath;
    }
}

let instance = null;
export function getConfigService() {
    if (!instance) {
        instance = new ConfigService();
    }
    return instance;
}
