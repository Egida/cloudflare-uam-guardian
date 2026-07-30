import { logger } from '../logger';
import { AppConfig } from '../types';
import { DetectionResult, DetectionRule, DetectionStatus, TrafficMetrics } from './detector.types';
import { RpsDetectionRule } from './rules/rps.rule';
import { ErrorRateDetectionRule } from './rules/error-rate.rule';
import { SystemHealthDetectionRule } from './rules/system-health.rule';

export class AttackDetector {
  private readonly config: AppConfig;
  private readonly rules: DetectionRule[];

  constructor(config: AppConfig, customRules?: DetectionRule[]) {
    this.config = config;
    this.rules = customRules ?? [
      new RpsDetectionRule(),
      new ErrorRateDetectionRule(),
      new SystemHealthDetectionRule(),
    ];
  }

  public registerRule(rule: DetectionRule): void {
    this.rules.push(rule);
    logger.info({ ruleName: rule.name }, 'Registered new detection rule.');
  }

  public evaluate(metrics: TrafficMetrics): DetectionResult {
    let totalWeightedScore = 0;
    let totalWeight = 0;
    let maxRuleScore = 0;
    const reasons: string[] = [];

    for (const rule of this.rules) {
      const evaluation = rule.evaluate(metrics, this.config);
      maxRuleScore = Math.max(maxRuleScore, evaluation.score);
      
      const weightedScore = evaluation.score * rule.weight;
      totalWeightedScore += weightedScore;
      totalWeight += rule.weight;

      if (evaluation.score > 0) {
        reasons.push(`[${rule.name}] ${evaluation.reason} (Score: ${evaluation.score})`);
      }
    }

    const finalScore = maxRuleScore >= 100
      ? 100
      : (totalWeight > 0 ? Math.min(100, Math.round(totalWeightedScore / totalWeight)) : 0);

    let status: DetectionStatus = 'NORMAL';
    if (finalScore >= 70) {
      status = 'ATTACK';
    } else if (finalScore >= 40) {
      status = 'WARNING';
    }

    if (reasons.length === 0) {
      reasons.push('Traffic metrics are within safe operational bounds.');
    }

    logger.debug(
      { metrics, finalScore, status, reasonCount: reasons.length },
      'Evaluated traffic metrics'
    );

    return {
      status,
      totalScore: finalScore,
      reasons,
      metrics,
    };
  }
}
