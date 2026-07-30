import { AppConfig } from '../types';

export type DetectionStatus = 'NORMAL' | 'WARNING' | 'ATTACK';

export interface TrafficMetrics {
  rps: number;
  uniqueIpCount?: number;
  threatScore?: number;
  errorRate?: number;
  cpuUsage?: number;
  timestamp?: number;
}

export interface RuleEvaluationResult {
  score: number;
  reason: string;
}

export interface DetectionRule {
  name: string;
  weight: number;
  evaluate(metrics: TrafficMetrics, config: AppConfig): RuleEvaluationResult;
}

export interface DetectionResult {
  status: DetectionStatus;
  totalScore: number;
  reasons: string[];
  metrics: TrafficMetrics;
}
