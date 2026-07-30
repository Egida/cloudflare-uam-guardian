import { logger } from '../logger';
export class TrafficDetector {
    config;
    cfClient;
    stateManager;
    discord;
    constructor(config, cfClient, stateManager, discord) {
        this.config = config;
        this.cfClient = cfClient;
        this.stateManager = stateManager;
        this.discord = discord;
    }
    async evaluate() {
        logger.debug('TrafficDetector evaluation placeholder.');
    }
}
