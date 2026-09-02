import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL?.toLowerCase() || 'info';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'token',
  'apitoken',
  'api_token',
  'cfapitoken',
  'cf_api_token',
  'password',
  'secret',
  'webhook',
  'webhookurl',
  'cookie',
]);

function redactSensitiveFields(obj: Record<string, unknown>, visited = new Set<unknown>(), depth = 0): Record<string, unknown> {
  if (depth > 10) return { _redacted: '[MAX_DEPTH_EXCEEDED]' };
  if (visited.has(obj)) return { _redacted: '[CIRCULAR_REFERENCE]' };
  
  visited.add(obj);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = redactSensitiveFields(value as Record<string, unknown>, visited, depth + 1);
    } else {
      result[key] = value;
    }
  }
  
  visited.delete(obj); 
  return result;
}

export const logger = pino({
  name: 'uam-guardian',
  level: logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    log(obj: Record<string, unknown>) {
      return redactSensitiveFields(obj);
    },
  },
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});
