// Golden (e): when every target in the chain fails with failover-class
// errors, the composite returns a TERMINAL `retryable:false` wrapper
// carrying the underlying error in `cause`. The kernel's turn-loop reads
// `retryable:false` and stops — it must NOT re-enter the composite at
// targets[0] and re-run the whole chain (retry amplification under a
// multi-provider outage). Exactly one failover_decision fires (T1→T2);
// no route_usage on either channel because no successful call landed.

import { describe, it, expect } from 'vitest';
import { failoverProvider } from '../src/index.mjs';
import { makeMockTarget, makeRecorder, makeFakeClock, userTranscript, err } from './_harness.mjs';

describe('chain exhausted: every target fails', () => {
  it('returns a retryable:false wrapper carrying the underlying error in cause', async () => {
    const t1 = makeMockTarget({
      name: 'anthropic-opus',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      results: [err({ status: 529, retryable: true, message: 'overloaded-1' })],
    });
    const t2 = makeMockTarget({
      name: 'openai-gpt5',
      provider: 'openai',
      model: 'gpt-5.4',
      results: [err({ status: 503, retryable: true, message: 'unavailable-2' })],
    });
    const rec = makeRecorder();
    const composite = failoverProvider([t1.target, t2.target], undefined, { emit: rec.emit, metrics: rec.metrics, ...makeFakeClock() });

    const req = composite.serializeRequest({ shadowTranscript: userTranscript(), input: undefined });
    const result = await composite.complete(req);

    expect(result.kind).toBe('error');
    expect(result.retryable).toBe(false);
    expect(result.status).toBe(503);
    expect(result.message).toContain('chain exhausted');
    expect(result.message).toContain('unavailable-2');

    expect(result.cause).toBeDefined();
    expect(result.cause.kind).toBe('error');
    expect(result.cause.status).toBe(503);
    expect(result.cause.retryable).toBe(true);
    expect(result.cause.message).toBe('unavailable-2');

    expect(t1.calls.complete).toHaveLength(1);
    expect(t2.calls.complete).toHaveLength(1);

    expect(rec.emitOf('failover_decision')).toHaveLength(1);
    expect(rec.metricsOf('route_usage')).toHaveLength(0);
  });
});
