import * as os from 'os';
import { logger } from '../logger';

export class SystemHealthMonitor {
  private timer: NodeJS.Timeout | null = null;
  private readonly historySize = 5; 
  private cpuHistory: number[] = [];
  
  private lastIdle = 0;
  private lastTotal = 0;

  constructor() {
    this.captureSnapshot();
  }

  public start(): void {
    if (this.timer) return;
    
    this.timer = setInterval(() => {
      this.captureSnapshot();
    }, 2000);
    
    logger.info('System Health Monitor started (CPU Tracking).');
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private captureSnapshot(): void {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        const time = cpu.times[type as keyof typeof cpu.times];
        total += time;
        if (type === 'idle') {
          idle += time;
        }
      }
    }

    if (this.lastTotal > 0) {
      const idleDelta = idle - this.lastIdle;
      const totalDelta = total - this.lastTotal;

      if (totalDelta > 0) {
        const usage = 100 - (idleDelta / totalDelta) * 100;
        
        this.cpuHistory.push(usage);
        if (this.cpuHistory.length > this.historySize) {
          this.cpuHistory.shift();
        }
      }
    }

    this.lastIdle = idle;
    this.lastTotal = total;
  }

  public getAverageCpuUsage(): number {
    if (this.cpuHistory.length === 0) return 0;
    const sum = this.cpuHistory.reduce((a, b) => a + b, 0);
    return sum / this.cpuHistory.length;
  }
}

let instance: SystemHealthMonitor | null = null;
export function getSystemHealthMonitor(): SystemHealthMonitor {
  if (!instance) {
    instance = new SystemHealthMonitor();
  }
  return instance;
}
