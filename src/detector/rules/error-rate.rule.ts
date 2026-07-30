import { AppConfig } from '../../types';
import { DetectionRule, RuleEvaluationResult, TrafficMetrics } from '../detector.types';

export class ErrorRateDetectionRule implements DetectionRule {
  public readonly name = 'HTTP 5xx Error Rate Rule';
  public readonly weight = 1.0;

  public evaluate(metrics: TrafficMetrics, config: AppConfig): RuleEvaluationResult {
    const errorRate = metrics.errorRate ?? 0;
    const threshold = config.errorRateThreshold;

    if (errorRate >= threshold) {
      return {
        score: 100,
        reason: `Server health critical: 5xx Error Rate (${errorRate.toFixed(2)}%) exceeded threshold (${threshold}%).`,
      };
    }

    if (errorRate > 0) {
      const progress = errorRate / threshold;
      const score = Math.floor(progress * 50);

      return {
        score,
        reason: `Server health warning: 5xx Error Rate is at ${errorRate.toFixed(2)}%.`,
      };
    }

    return {
      score: 0,
      reason: `Server health normal (0% 5xx errors).`,
    };
  }
}
