import { SecurityLevel } from '../types';

export type NotificationType = 'ATTACK_STARTED' | 'ATTACK_STOPPED' | 'APP_STARTED' | 'APP_ERROR';

export interface NotificationDetails {
  status: string;
  reason: string;
  requestCount?: number | string;
  uniqueIp?: number | string;
  errorRate?: number | string;
  cpuUsage?: number | string;
  currentScore?: number | string;
  securityLevel?: SecurityLevel | string;
  errorDetails?: string;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: DiscordEmbedField[];
  timestamp: string;
  footer?: {
    text: string;
  };
}

export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  embeds: DiscordEmbed[];
}
