import { AppConfig } from '../../types';
import { DetectionRule, RuleEvaluationResult, TrafficMetrics } from '../detector.types';

export class RpsDetectionRule implements DetectionRule {
  public readonly name = 'RPS Threshold Rule';
  public readonly weight = 1.0;

  public evaluate(metrics: TrafficMetrics, config: AppConfig): RuleEvaluationResult {
    const rps = metrics.rps;
    const enableThreshold = config.enableThreshold;
    const disableThreshold = config.disableThreshold;

    if (rps >= enableThreshold) {
      return {
        score: 100,
        reason: `RPS (${rps}) reached or exceeded attack enable threshold (${enableThreshold}).`,
      };
    }

    if (rps >= disableThreshold) {
      const range = enableThreshold - disableThreshold;
      const progress = range > 0 ? (rps - disableThreshold) / range : 0;
      const score = Math.floor(40 + progress * 59);

      return {
        score,
        reason: `RPS (${rps}) exceeds warning disable threshold (${disableThreshold}).`,
      };
    }

    return {
      score: 0,
      reason: `RPS (${rps}) is below threshold (${disableThreshold}).`,
    };
  }
}
