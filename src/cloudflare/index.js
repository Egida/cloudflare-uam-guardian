import axios from 'axios';
import { logger } from '../logger';
export class CloudflareClient {
    api;
    zoneId;
    constructor(apiToken, zoneId) {
        this.zoneId = zoneId;
        this.api = axios.create({
            baseURL: 'https://api.cloudflare.com/client/v4',
            headers: {
                Authorization: `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        });
    }
    async getRecentRequestCount() {
        const query = `
      query GetTraffic($zoneTag: string!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequestsAdaptiveGroups(
              limit: 1,
              filter: {
                datetime_geq: "${new Date(Date.now() - 60000).toISOString()}"
              }
            ) {
              count
            }
          }
        }
      }
    `;
        try {
            const response = await this.api.post('/graphql', {
                query,
                variables: { zoneTag: this.zoneId },
            });
            if (response.data.errors && response.data.errors.length > 0) {
                logger.error({ errors: response.data.errors }, 'GraphQL API returned errors');
                return 0;
            }
            const groups = response.data.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups;
            if (groups && groups.length > 0) {
                const countOverMinute = groups[0].count;
                return Math.floor(countOverMinute / 60);
            }
            return 0;
        }
        catch (err) {
            logger.error({ err: err.message }, 'Failed to fetch traffic from Cloudflare API');
            throw err;
        }
    }
    async setSecurityLevel(level) {
        try {
            await this.api.patch(`/zones/${this.zoneId}/settings/security_level`, {
                value: level,
            });
            logger.info({ level }, 'Successfully changed Cloudflare security level');
        }
        catch (err) {
            logger.error({ err: err.message, level }, 'Failed to change Cloudflare security level');
            throw err;
        }
    }
}
