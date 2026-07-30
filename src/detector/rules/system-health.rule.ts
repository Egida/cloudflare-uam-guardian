import { AppConfig } from '../../types';
import { DetectionRule, RuleEvaluationResult, TrafficMetrics } from '../detector.types';

export class SystemHealthDetectionRule implements DetectionRule {
  public readonly name = 'Local CPU Health Rule';
  public readonly weight = 2.0; 

  public evaluate(metrics: TrafficMetrics, config: AppConfig): RuleEvaluationResult {
    if (!config.localMonitoringEnabled) {
      return {
        score: 0,
        reason: 'Local system monitoring is disabled.',
      };
    }

    const cpuUsage = metrics.cpuUsage ?? 0;
    const threshold = config.cpuThreshold;

    if (cpuUsage >= threshold) {
      return {
        score: 100, 
        reason: `CRITICAL: Local CPU usage (${cpuUsage.toFixed(1)}%) exceeded threshold (${threshold}%). Potential DDoS bypass detected.`,
      };
    }

    if (cpuUsage > 0) {
      const progress = cpuUsage / threshold;
      const score = Math.floor(progress * 40); 

      return {
        score,
        reason: `Local CPU usage is at ${cpuUsage.toFixed(1)}%.`,
      };
    }

    return {
      score: 0,
      reason: 'Local CPU usage is minimal.',
    };
  }
}
