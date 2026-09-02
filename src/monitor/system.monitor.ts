import * as os from 'os';
import { logger } from '../logger';

export class SystemHealthMonitor {
  private timer: NodeJS.Timeout | null = null;
  private readonly historySize = 30;
  private cpuHistory: number[] = [];

  private lastIdle = 0;
  private lastTotal = 0;

  private lastSummaryAt: number = 0;
  private readonly summaryIntervalMs: number = 60_000;

  constructor() {
    this.captureSnapshot();
  }

  public start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.captureSnapshot();
    }, 2000);

    logger.info(
      { sampleIntervalMs: 2000, historySize: this.historySize, summaryIntervalMs: this.summaryIntervalMs },
      'System Health Monitor started (CPU & Memory Tracking).'
    );
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('System Health Monitor stopped.');
    }
  }

  private captureSnapshot(): void {
    try {
      const cpus = os.cpus();

      if (!cpus || cpus.length === 0) {
        logger.warn('os.cpus() returned empty data. Skipping CPU snapshot.');
        return;
      }

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
        const idleDelta = Math.max(0, idle - this.lastIdle);
        const totalDelta = Math.max(0, total - this.lastTotal);

        if (totalDelta > 0) {
          let usage = 100 - (idleDelta / totalDelta) * 100;
          usage = Math.max(0, Math.min(100, usage));

          this.cpuHistory.push(usage);
          if (this.cpuHistory.length > this.historySize) {
            this.cpuHistory.shift();
          }
        }
      }

      this.lastIdle = idle;
      this.lastTotal = total;

      this.logPeriodicSummary();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { error: errorMsg },
        'Error during CPU snapshot capture. Monitor will continue but this sample is lost.'
      );
    }
  }

  private logPeriodicSummary(): void {
    const now = Date.now();
    if (now - this.lastSummaryAt < this.summaryIntervalMs) return;

    this.lastSummaryAt = now;
    const avgCpu = this.getAverageCpuUsage();
    const memInfo = this.getMemoryInfo();

    logger.info(
      {
        avgCpuUsage: `${avgCpu.toFixed(1)}%`,
        cpuSamples: this.cpuHistory.length,
        cpuCores: os.cpus().length,
        ...memInfo,
      },
      'System health summary'
    );
  }

  public getAverageCpuUsage(): number {
    if (this.cpuHistory.length === 0) return 0;
    const sum = this.cpuHistory.reduce((a, b) => a + b, 0);
    return sum / this.cpuHistory.length;
  }

  public getMemoryInfo(): {
    processRssMb: string;
    processHeapUsedMb: string;
    systemTotalMb: string;
    systemFreeMb: string;
    systemUsedPercent: string;
  } {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedPercent = ((totalMem - freeMem) / totalMem) * 100;

    return {
      processRssMb: (memUsage.rss / 1024 / 1024).toFixed(1),
      processHeapUsedMb: (memUsage.heapUsed / 1024 / 1024).toFixed(1),
      systemTotalMb: (totalMem / 1024 / 1024).toFixed(0),
      systemFreeMb: (freeMem / 1024 / 1024).toFixed(0),
      systemUsedPercent: usedPercent.toFixed(1),
    };
  }
}

let instance: SystemHealthMonitor | null = null;
export function getSystemHealthMonitor(): SystemHealthMonitor {
  if (!instance) {
    instance = new SystemHealthMonitor();
  }
  return instance;
}
