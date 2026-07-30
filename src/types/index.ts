export type SecurityLevel = 'off' | 'essentially_off' | 'low' | 'medium' | 'high' | 'under_attack';

export interface AppConfig {
  cfApiToken: string;
  cfZoneId: string;
  checkInterval: number;
  enableThreshold: number;
  disableThreshold: number;
  cooldownMinutes: number;
  defaultSecurityLevel: SecurityLevel;
  discordWebhookUrl?: string;
  logLevel: string;
  stateFilePath: string;
  errorRateThreshold: number;
  localMonitoringEnabled: boolean;
  cpuThreshold: number;
}

export interface AppState {
  isUnderAttack: boolean;
  enabledAt: number | null;
  lastAttackDetected: number | null;
  cooldownUntil: number | null;
  lastDecision: string | null;
}

export interface CloudflareApiResponse<T> {
  result: T;
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
}

export interface CloudflareSecurityLevelResult {
  id: string;
  value: SecurityLevel;
  editable: boolean;
  modified_on?: string;
}

export interface CloudflareAnalyticsResponse {
  data: {
    viewer: {
      zones: Array<{
        totalRequests: Array<{
          count: number;
        }>;
        errorRequests: Array<{
          count: number;
        }>;
      }>;
    };
  };
  errors?: any[];
}
