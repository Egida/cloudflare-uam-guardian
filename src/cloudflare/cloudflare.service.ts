import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../logger';
import { CloudflareAnalyticsResponse, CloudflareApiResponse, CloudflareSecurityLevelResult, SecurityLevel, TrafficMetricsResult } from '../types';
import { CLOUDFLARE_BASE_URL, CloudflareEndpoints } from './cloudflare.endpoints';

export class CloudflareApiError extends Error {
  public readonly statusCode?: number;
  public readonly errors?: Array<{ code: number; message: string }>;

  constructor(message: string, statusCode?: number, errors?: Array<{ code: number; message: string }>) {
    super(message);
    this.name = 'CloudflareApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

export interface CloudflareServiceOptions {
  apiToken: string;
  zoneId: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class CloudflareService {
  private readonly client: AxiosInstance;
  private readonly zoneId: string;
  private readonly maxRetries: number;

  constructor(options: CloudflareServiceOptions) {
    if (!options.apiToken) {
      throw new Error('CloudflareService requires an API token.');
    }
    if (!options.zoneId) {
      throw new Error('CloudflareService requires a Zone ID.');
    }

    this.zoneId = options.zoneId;
    this.maxRetries = options.maxRetries ?? 3;

    this.client = axios.create({
      baseURL: CLOUDFLARE_BASE_URL,
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        'Content-Type': 'application/json',
      },
      timeout: options.timeoutMs ?? 10000,
    });
  }

  private async request<T>(
    operationName: string,
    executeCall: () => Promise<{ data: CloudflareApiResponse<T> }>
  ): Promise<T> {
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        logger.debug({ operationName, attempt }, 'Executing Cloudflare API request');
        const response = await executeCall();

        if (!response.data.success) {
          const apiErrors = response.data.errors || [];
          const errorMsg = apiErrors.map((e) => `[${e.code}] ${e.message}`).join(', ') || 'Unknown API failure';
          throw new CloudflareApiError(`Cloudflare API Error (${operationName}): ${errorMsg}`, 200, apiErrors);
        }

        logger.info({ operationName }, 'Cloudflare API request succeeded');
        return response.data.result;
      } catch (err: unknown) {
        attempt++;

        if (err instanceof CloudflareApiError) {
          logger.error({ operationName, errors: err.errors }, err.message);
          throw err;
        }

        if (axios.isAxiosError(err)) {
          const axiosErr = err as AxiosError<CloudflareApiResponse<unknown>>;
          const status = axiosErr.response?.status;
          const apiErrors = axiosErr.response?.data?.errors;

          if (status === 429) {
            const retryAfterHeader = axiosErr.response?.headers?.['retry-after'];
            const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : Math.pow(2, attempt);
            const waitMs = (isNaN(retryAfterSeconds) ? 2 : retryAfterSeconds) * 1000;

            logger.warn(
              { operationName, attempt, status, waitMs },
              `Rate limited by Cloudflare API (429). Retrying after ${waitMs}ms...`
            );

            if (attempt <= this.maxRetries) {
              await new Promise((res) => setTimeout(res, waitMs));
              continue;
            }
          }

          if (status && status >= 400 && status < 500 && status !== 429) {
            const errorMsg = apiErrors?.map((e) => `[${e.code}] ${e.message}`).join(', ') || axiosErr.message;
            logger.error({ operationName, status, errorMsg }, `Client error during Cloudflare API call (${status})`);
            throw new CloudflareApiError(`Cloudflare API Client Error (${status}): ${errorMsg}`, status, apiErrors);
          }

          if (attempt <= this.maxRetries) {
            const backoffMs = Math.pow(2, attempt) * 1000;
            logger.warn(
              { operationName, attempt, maxRetries: this.maxRetries, error: axiosErr.message, backoffMs },
              `Cloudflare API call failed (${axiosErr.message}). Retrying in ${backoffMs}ms...`
            );
            await new Promise((res) => setTimeout(res, backoffMs));
            continue;
          }
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error({ operationName, error: errorMessage, attempt }, 'Cloudflare API request failed after max retries');
        throw new CloudflareApiError(`Cloudflare API call (${operationName}) failed: ${errorMessage}`);
      }
    }

    throw new CloudflareApiError(`Cloudflare API call (${operationName}) failed after ${this.maxRetries} retries`);
  }

  public async getTrafficMetrics(): Promise<TrafficMetricsResult | null> {
    const operationName = 'getTrafficMetrics';
    const query = `
      query GetZoneTraffic($zoneTag: String!, $datetimeGeq: String!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            totalRequests: httpRequestsAdaptiveGroups(
              limit: 1,
              filter: { datetime_geq: $datetimeGeq }
            ) {
              count
            }
            errorRequests: httpRequestsAdaptiveGroups(
              limit: 1,
              filter: { datetime_geq: $datetimeGeq, edgeResponseStatus_geq: 500, edgeResponseStatus_leq: 599 }
            ) {
              count
            }
          }
        }
      }
    `;

    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      const startMs = Date.now();

      try {
        logger.debug({ operationName, attempt }, 'Fetching traffic metrics from Cloudflare GraphQL API');

        const response = await this.client.post<CloudflareAnalyticsResponse>(CloudflareEndpoints.graphql(), {
          query,
          variables: {
            zoneTag: this.zoneId,
            datetimeGeq: threeMinutesAgo,
          },
        });

        const latencyMs = Date.now() - startMs;

        if (response.data.errors && response.data.errors.length > 0) {
          logger.error(
            { operationName, errors: response.data.errors, latencyMs, attempt },
            'Cloudflare GraphQL API returned query-level errors. Treating as failure (fail-safe).'
          );
          return null;
        }

        const zoneData = response.data.data?.viewer?.zones?.[0];
        if (!zoneData) {
          logger.warn(
            { operationName, latencyMs, attempt },
            'Cloudflare GraphQL response contained no zone data. Zone may be misconfigured.'
          );
          return null;
        }

        const totalCount = zoneData.totalRequests?.[0]?.count || 0;
        const errorCount = zoneData.errorRequests?.[0]?.count || 0;

        const rps = Math.floor(totalCount / 180);
        const errorRate = totalCount > 0 ? (errorCount / totalCount) * 100 : 0;

        logger.debug(
          { operationName, latencyMs, rps, errorRate: `${errorRate.toFixed(2)}%`, totalCount, errorCount },
          'Traffic metrics fetched successfully'
        );

        return { rps, errorRate, latencyMs };
      } catch (err: unknown) {
        const latencyMs = Date.now() - startMs;
        attempt++;

        if (axios.isAxiosError(err)) {
          const axiosErr = err as AxiosError;
          const status = axiosErr.response?.status;
          const errorCode = axiosErr.code;

          let errorCategory: string;
          if (errorCode === 'ECONNABORTED' || errorCode === 'ETIMEDOUT' || axiosErr.message.includes('timeout')) {
            errorCategory = 'TIMEOUT';
          } else if (status === 401 || status === 403) {
            errorCategory = 'AUTH_ERROR';
            logger.error(
              { operationName, status, errorCategory, latencyMs },
              `Cloudflare API authentication failed (${status}). Check CF_API_TOKEN validity.`
            );
            return null;
          } else if (status === 429) {
            errorCategory = 'RATE_LIMITED';
            const retryAfterHeader = axiosErr.response?.headers?.['retry-after'];
            
            let retryAfterSeconds = Math.pow(2, attempt); 
            if (retryAfterHeader) {
              const parsedInt = parseInt(retryAfterHeader, 10);
              if (!isNaN(parsedInt)) {
                retryAfterSeconds = parsedInt;
              } else {
                const dateMs = Date.parse(retryAfterHeader);
                if (!isNaN(dateMs)) {
                  retryAfterSeconds = Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
                }
              }
            }
            
            const waitMs = Math.max(2, retryAfterSeconds) * 1000;

            if (attempt <= this.maxRetries) {
              logger.warn(
                { operationName, attempt, maxRetries: this.maxRetries, errorCategory, waitMs, latencyMs },
                `Rate limited by Cloudflare API (429). Retrying after ${waitMs}ms...`
              );
              await new Promise((res) => setTimeout(res, waitMs));
              continue;
            }
          } else if (errorCode === 'ECONNRESET' || errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN') {
            errorCategory = 'NETWORK_ERROR';
          } else if (status && status >= 500) {
            errorCategory = 'SERVER_ERROR';
          } else {
            errorCategory = 'UNKNOWN_HTTP_ERROR';
          }

          if (attempt <= this.maxRetries) {
            const backoffMs = Math.pow(2, attempt) * 1000;
            logger.warn(
              { operationName, attempt, maxRetries: this.maxRetries, errorCategory, status, errorCode, latencyMs, backoffMs },
              `Traffic metrics fetch failed (${errorCategory}). Retrying in ${backoffMs}ms...`
            );
            await new Promise((res) => setTimeout(res, backoffMs));
            continue;
          }

          logger.error(
            { operationName, errorCategory, status, errorCode, latencyMs, attempt },
            `Traffic metrics fetch failed after ${this.maxRetries} retries (${errorCategory}). Returning null (fail-safe).`
          );
        } else {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error(
            { operationName, error: errorMsg, latencyMs, attempt },
            'Unexpected non-Axios error during traffic metrics fetch. Returning null (fail-safe).'
          );
        }

        return null;
      }
    }

    logger.error(
      { operationName, maxRetries: this.maxRetries },
      `Traffic metrics fetch exhausted all ${this.maxRetries} retries. Returning null (fail-safe).`
    );
    return null;
  }

  public async getCurrentSecurityLevel(): Promise<SecurityLevel> {
    const endpoint = CloudflareEndpoints.securityLevel(this.zoneId);
    const result = await this.request<CloudflareSecurityLevelResult>('getCurrentSecurityLevel', () =>
      this.client.get<CloudflareApiResponse<CloudflareSecurityLevelResult>>(endpoint)
    );
    return result.value;
  }

  public async enableUnderAttackMode(): Promise<SecurityLevel> {
    return this.setSecurityLevel('under_attack');
  }

  public async disableUnderAttackMode(targetLevel: SecurityLevel = 'medium'): Promise<SecurityLevel> {
    if (targetLevel === 'under_attack') {
      throw new Error('Cannot disable Under Attack Mode by setting level to "under_attack".');
    }
    return this.setSecurityLevel(targetLevel);
  }

  public async setSecurityLevel(level: SecurityLevel): Promise<SecurityLevel> {
    const endpoint = CloudflareEndpoints.securityLevel(this.zoneId);
    logger.info({ zoneId: this.zoneId, targetLevel: level }, 'Changing Cloudflare Security Level');

    const result = await this.request<CloudflareSecurityLevelResult>('setSecurityLevel', () =>
      this.client.patch<CloudflareApiResponse<CloudflareSecurityLevelResult>>(endpoint, {
        value: level,
      })
    );

    logger.info({ zoneId: this.zoneId, currentLevel: result.value }, 'Cloudflare Security Level updated successfully');
    return result.value;
  }
}
