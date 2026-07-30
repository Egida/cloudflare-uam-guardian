import * as fs from 'fs';
import * as path from 'path';
import { AppState } from '../types';
import { logger } from '../logger';

export const DEFAULT_APP_STATE: Readonly<AppState> = Object.freeze({
  isUnderAttack: false,
  enabledAt: null,
  lastAttackDetected: null,
  cooldownUntil: null,
  lastDecision: null,
});

export class StateManager {
  private readonly filePath: string;
  private currentState: AppState;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    this.ensureDirectoryExists();
    this.currentState = this.loadState();
  }

  private ensureDirectoryExists(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        logger.info({ dir }, 'Created state directory.');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error({ dir, error: errorMsg }, 'Failed to create state directory.');
        throw new Error(`Failed to create state directory: ${errorMsg}`);
      }
    }
  }

  private loadState(): AppState {
    if (!fs.existsSync(this.filePath)) {
      logger.info({ filePath: this.filePath }, 'State file does not exist. Initializing with default state.');
      const initialState = { ...DEFAULT_APP_STATE };
      this.writeAtomic(initialState);
      return initialState;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;

      if (!this.isValidState(parsed)) {
        throw new Error('State file structure is invalid or missing required properties.');
      }

      logger.info({ filePath: this.filePath, state: parsed }, 'State loaded successfully.');
      return parsed;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ filePath: this.filePath, error: errorMsg }, 'Corrupted state file detected. Recovering...');

      this.backupCorruptFile();

      const recoveredState = { ...DEFAULT_APP_STATE };
      this.writeAtomic(recoveredState);
      return recoveredState;
    }
  }

  private isValidState(obj: any): obj is AppState {
    if (typeof obj !== 'object' || obj === null) return false;

    const hasIsUnderAttack = typeof obj.isUnderAttack === 'boolean';
    const hasEnabledAt = obj.enabledAt === null || typeof obj.enabledAt === 'number';
    const hasLastAttackDetected = obj.lastAttackDetected === null || typeof obj.lastAttackDetected === 'number';
    const hasCooldownUntil = obj.cooldownUntil === null || typeof obj.cooldownUntil === 'number';
    const hasLastDecision = obj.lastDecision === null || typeof obj.lastDecision === 'string';

    return hasIsUnderAttack && hasEnabledAt && hasLastAttackDetected && hasCooldownUntil && hasLastDecision;
  }

  private backupCorruptFile(): void {
    try {
      const corruptPath = `${this.filePath}.corrupt.${Date.now()}`;
      fs.renameSync(this.filePath, corruptPath);
      logger.warn({ corruptPath }, 'Corrupt state file backed up.');
    } catch (backupErr: unknown) {
      const errorMsg = backupErr instanceof Error ? backupErr.message : String(backupErr);
      logger.error({ error: errorMsg }, 'Failed to backup corrupt state file.');
    }
  }

  private writeAtomic(state: AppState): void {
    const tempPath = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    try {
      const jsonContent = JSON.stringify(state, null, 2);
      fs.writeFileSync(tempPath, jsonContent, 'utf-8');
      fs.renameSync(tempPath, this.filePath);
      logger.debug({ filePath: this.filePath }, 'State file written atomically.');
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ tempPath, filePath: this.filePath, error: errorMsg }, 'Atomic state write failed.');

      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
        }
      }
      throw new Error(`Failed to write state file atomically: ${errorMsg}`);
    }
  }

  public getState(): Readonly<AppState> {
    return { ...this.currentState };
  }

  public updateState(partialState: Partial<AppState>): Readonly<AppState> {
    this.currentState = {
      ...this.currentState,
      ...partialState,
    };
    this.writeAtomic(this.currentState);
    return this.getState();
  }

  public resetState(): Readonly<AppState> {
    this.currentState = { ...DEFAULT_APP_STATE };
    this.writeAtomic(this.currentState);
    return this.getState();
  }

  public saveState(): void {
    this.writeAtomic(this.currentState);
  }
}
