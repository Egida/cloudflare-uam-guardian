import axios from 'axios';
import { logger } from '../logger';
export class DiscordNotifier {
    webhookUrl;
    constructor(webhookUrl) {
        this.webhookUrl = webhookUrl;
    }
    async sendAlert(title, description, isAttack) {
        if (!this.webhookUrl) {
            return;
        }
        try {
            const payload = {
                embeds: [
                    {
                        title,
                        description,
                        color: isAttack ? 16711680 : 65280, 
                        timestamp: new Date().toISOString(),
                    },
                ],
            };
            await axios.post(this.webhookUrl, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000,
            });
            logger.info('Discord alert sent successfully.');
        }
        catch (err) {
            logger.error({ err: err.message }, 'Failed to send Discord alert.');
        }
    }
    async sendError(title, error) {
        if (!this.webhookUrl) {
            return;
        }
        try {
            const payload = {
                embeds: [
                    {
                        title,
                        description: `\`\`\`\n${error}\n\`\`\``,
                        color: 16753920, // Orange
                        timestamp: new Date().toISOString(),
                    },
                ],
            };
            await axios.post(this.webhookUrl, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000,
            });
        }
        catch (err) {
            logger.error({ err: err.message }, 'Failed to send Discord error alert.');
        }
    }
}
