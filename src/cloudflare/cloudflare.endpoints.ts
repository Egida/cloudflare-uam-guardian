export const CLOUDFLARE_BASE_URL = 'https://api.cloudflare.com/client/v4';

export const CloudflareEndpoints = {
  securityLevel: (zoneId: string) => `/zones/${zoneId}/settings/security_level`,
  graphql: () => `/graphql`,
};
