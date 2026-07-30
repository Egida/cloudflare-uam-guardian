import * as fs from 'fs';
import { logger } from '../logger';
export class StateManager {
    stateFilePath;
    state;
    constructor(stateFilePath) {
        this.stateFilePath = stateFilePath;
        this.state = this.loadState();
    }
    loadState() {
        try {
            if (fs.existsSync(this.stateFilePath)) {
                const raw = fs.readFileSync(this.stateFilePath, 'utf8');
                return JSON.parse(raw);
            }
        }
        catch (err) {
            logger.error({ err: err.message }, 'Failed to load state from file. Falling back to default.');
        }
        return {
            isUnderAttack: false,
            lastAttackTime: 0,
            lastNormalTime: Date.now(),
        };
    }
    saveState() {
        try {
            fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf8');
        }
        catch (err) {
            logger.error({ err: err.message }, 'Failed to save state to file.');
        }
    }
    getState() {
        return this.state;
    }
    setUnderAttack(isUnderAttack) {
        this.state.isUnderAttack = isUnderAttack;
        if (isUnderAttack) {
            this.state.lastAttackTime = Date.now();
        }
        else {
            this.state.lastNormalTime = Date.now();
        }
        this.saveState();
    }
}
