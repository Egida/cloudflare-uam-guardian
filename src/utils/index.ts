import { logger } from '../logger';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  operation: () => Promise<T>,
  retries: number = 3,
  delayMs: number = 2000,
  context: string = 'Operation'
): Promise<T> {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await operation();
    } catch (error: any) {
      attempt++;
      logger.warn({ error: error.message, attempt, retries }, `${context} failed. Retrying...`);
      if (attempt >= retries) {
        logger.error({ error: error.message }, `${context} failed after ${retries} attempts.`);
        throw error;
      }
      await sleep(delayMs);
    }
  }
  throw new Error('Unreachable');
}
