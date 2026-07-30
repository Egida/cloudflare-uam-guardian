import { logger } from '../logger';
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function withRetry(operation, retries = 3, delayMs = 2000, context = 'Operation') {
    let attempt = 0;
    while (attempt < retries) {
        try {
            return await operation();
        }
        catch (error) {
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
