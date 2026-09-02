import assert from 'assert';
import { AttackDetector } from '../detector/detector.service';
import { TrafficMetrics } from '../detector/detector.types';
import { AppConfig, SecurityLevel } from '../types';
import { logger } from '../logger';

// Suppress logs during testing
logger.level = 'silent';

const mockConfig: AppConfig = {
  cfApiToken: 'test-token',
  cfZoneId: 'test-zone',
  checkInterval: 5,
  enableThreshold: 100,
  disableThreshold: 50,
  cooldownMinutes: 5,
  defaultSecurityLevel: 'medium' as SecurityLevel,
  logLevel: 'silent',
  stateFilePath: './test-state.json',
  errorRateThreshold: 10,
  localMonitoringEnabled: true,
  cpuThreshold: 90,
  heartbeatIntervalMinutes: 360,
  maxConsecutiveApiFailures: 5,
};

function runTests() {
  console.log('Running Deep Tests for UAM Guardian...');

  const detector = new AttackDetector(mockConfig);

  // Test 1: Normal Traffic
  let metrics: TrafficMetrics = {
    rps: 30,
    errorRate: 1, 
    cpuUsage: 20, 
    timestamp: Date.now(),
  };
  let result = detector.evaluate(metrics);
  assert.strictEqual(result.status, 'NORMAL', 'Expected NORMAL status for low traffic');
  assert.ok(result.totalScore < 40, 'Expected score below WARNING threshold (40)');

  // Test 2: Warning Traffic (RPS between disable and enable threshold)
  metrics = {
    rps: 75, 
    errorRate: 2,
    cpuUsage: 30,
    timestamp: Date.now(),
  };
  result = detector.evaluate(metrics);
  assert.strictEqual(result.status, 'WARNING', 'Expected WARNING status for medium traffic');
  assert.ok(result.totalScore >= 40 && result.totalScore < 70, 'Expected score in WARNING range (40-69)');

  // Test 3: Attack Traffic (RPS over enable threshold)
  metrics = {
    rps: 120,
    errorRate: 5,
    cpuUsage: 40,
    timestamp: Date.now(),
  };
  result = detector.evaluate(metrics);
  assert.strictEqual(result.status, 'ATTACK', 'Expected ATTACK status for high RPS');
  assert.ok(result.totalScore >= 70, 'Expected score in ATTACK range (>=70)');

  // Test 4: Attack Traffic (Error Rate Exceeded)
  metrics = {
    rps: 40, 
    errorRate: 15, 
    cpuUsage: 20,
    timestamp: Date.now(),
  };
  result = detector.evaluate(metrics);
  assert.strictEqual(result.status, 'ATTACK', 'Expected ATTACK status due to high Error Rate');
  assert.ok(result.totalScore >= 70, 'Expected score in ATTACK range due to error rate');

  // Test 5: Attack Traffic (CPU Exhaustion - Layer 7 bypass attempt)
  metrics = {
    rps: 10, 
    errorRate: 0,
    cpuUsage: 95, 
    timestamp: Date.now(),
  };
  result = detector.evaluate(metrics);
  assert.strictEqual(result.status, 'ATTACK', 'Expected ATTACK status due to CPU exhaustion');
  assert.ok(result.totalScore >= 70, 'Expected score in ATTACK range due to CPU');

  // Test 6: Partial Weights (Combined factors)
  metrics = {
    rps: 75, 
    errorRate: 5,
    cpuUsage: 45, 
    timestamp: Date.now(),
  };
  result = detector.evaluate(metrics);
  assert.strictEqual(result.status, 'WARNING', 'Expected WARNING status because the max single rule (RPS) is at warning level');

  console.log('✅ All Deep Tests Passed. Logic is mathematically sound and verified.');
}

try {
  runTests();
} catch (error: any) {
  console.error('❌ Test Failed:', error.message);
  process.exit(1);
}
