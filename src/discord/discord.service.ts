import axios, { AxiosInstance } from 'axios';
import { logger } from '../logger';
import {
  DiscordEmbed,
  DiscordWebhookPayload,
  NotificationDetails,
  NotificationType,
} from './discord.types';

export interface DiscordServiceOptions {
  webhookUrl?: string;
  cooldownMs?: number;
}

export class DiscordNotificationService {
  private readonly webhookUrl?: string;
  private readonly cooldownMs: number;
  private readonly lastSentMap: Map<NotificationType, number>;
  private readonly client: AxiosInstance;

  private static readonly COOLDOWN_EXEMPT_TYPES: ReadonlySet<NotificationType> = new Set([
    'ATTACK_STARTED',
  ]);

  constructor(options: DiscordServiceOptions) {
    this.webhookUrl = options.webhookUrl?.trim();
    this.cooldownMs = options.cooldownMs ?? 60000;
    this.lastSentMap = new Map();

    this.client = axios.create({
      timeout: 5000,
    });
  }

  public async notify(type: NotificationType, details: NotificationDetails): Promise<boolean> {
    if (!this.webhookUrl) {
      logger.debug({ type }, 'Discord webhook URL is not configured. Skipping notification.');
      return false;
    }

    const isExempt = DiscordNotificationService.COOLDOWN_EXEMPT_TYPES.has(type);

    if (!isExempt && this.isCooldownActive(type)) {
      logger.warn({ type, cooldownMs: this.cooldownMs }, 'Notification suppressed due to cooldown.');
      return false;
    }

    const embed = this.buildEmbed(type, details);
    const payload: DiscordWebhookPayload = {
      username: 'CF Auto UAM Guardian',
      embeds: [embed],
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.client.post(this.webhookUrl, payload);
        this.lastSentMap.set(type, Date.now());
        logger.info({ type, attempt }, 'Discord notification sent successfully.');
        return true;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (attempt === 0) {
          logger.warn({ type, error: errorMsg, attempt }, 'Discord notification failed. Retrying once...');
          await new Promise((res) => setTimeout(res, 1000));
          continue;
        }
        logger.error({ type, error: errorMsg, attempt }, 'Failed to send Discord webhook notification after retry.');
        return false;
      }
    }

    return false;
  }

  public async notifyAppStarted(details?: Partial<NotificationDetails>): Promise<boolean> {
    return this.notify('APP_STARTED', {
      status: 'ONLINE',
      reason: 'Daemon process initialized and monitoring started.',
      ...details,
    });
  }

  public async notifyAttackStarted(details: NotificationDetails): Promise<boolean> {
    return this.notify('ATTACK_STARTED', details);
  }

  public async notifyAttackStopped(details: NotificationDetails): Promise<boolean> {
    return this.notify('ATTACK_STOPPED', details);
  }

  public async notifyAppError(error: Error | string, details?: Partial<NotificationDetails>): Promise<boolean> {
    const errorMsg = typeof error === 'string' ? error : error.message;
    return this.notify('APP_ERROR', {
      status: 'ERROR',
      reason: 'Runtime error occurred in Guardian daemon.',
      errorDetails: errorMsg,
      ...details,
    });
  }

  private isCooldownActive(type: NotificationType): boolean {
    const lastSent = this.lastSentMap.get(type);
    if (!lastSent) return false;
    return Date.now() - lastSent < this.cooldownMs;
  }

  private buildEmbed(type: NotificationType, details: NotificationDetails): DiscordEmbed {
    const now = new Date();
    const isoTimestamp = now.toISOString();
    const formattedTime = now.toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'medium',
      timeStyle: 'long',
    }) + ' WIB';

    let title = 'Cloudflare Guardian Alert';
    let color = 3447003;

    switch (type) {
      case 'ATTACK_STARTED':
        title = '🚨 ATTACK DETECTED - UAM ENABLED';
        color = 15158332;
        break;
      case 'ATTACK_STOPPED':
        title = '✅ TRAFFIC NORMALIZED - UAM DISABLED';
        color = 3066993;
        break;
      case 'APP_STARTED':
        title = '🛡️ GUARDIAN DAEMON STARTED';
        color = 3447003;
        break;
      case 'APP_ERROR':
        title = '⚠️ GUARDIAN APPLICATION ERROR';
        color = 15105570;
        break;
    }

    const fields = [
      { name: '🕒 Time', value: formattedTime, inline: true },
      { name: '📌 Current Status', value: details.status, inline: true },
      { name: '🔒 Security Level', value: String(details.securityLevel ?? 'N/A'), inline: true },
      { name: '📝 Reason', value: details.reason, inline: false },
      { name: '📊 Current Request Count', value: String(details.requestCount ?? 'N/A'), inline: true },
      { name: '⚠️ Error Rate', value: details.errorRate !== undefined ? `${Number(details.errorRate).toFixed(2)}%` : 'N/A', inline: true },
      { name: '💻 Server CPU', value: details.cpuUsage !== undefined ? `${Number(details.cpuUsage).toFixed(1)}%` : 'N/A', inline: true },
      { name: '🎯 Current Score', value: String(details.currentScore ?? 'N/A'), inline: true },
    ];

    if (details.errorDetails) {
      fields.push({
        name: '❌ Error Details',
        value: `\`\`\`\n${details.errorDetails.substring(0, 1000)}\n\`\`\``,
        inline: false,
      });
    }

    return {
      title,
      color,
      fields,
      timestamp: isoTimestamp,
      footer: {
        text: 'Cloudflare Auto Under Attack Guardian',
      },
    };
  }
}
