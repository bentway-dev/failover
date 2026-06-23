// Golden (e): when every target in the chain fails with failover-class
// errors, the composite returns the FINAL target's terminal error
// unchanged — letting the loop's standard error path render it. Exactly
// one failover_decision fires (T1→T2); no further decisions after the
// last target is reached.

import { describe, it, expect } from 'vitest';
import { failoverProvider } from '../src/index.mjs';
import { makeMockTarget, makeRecorder, makeFakeClock, userTranscript, err } from './_harness.mjs';

describe('chain exhausted: every target fails', () => {
  it('returns the terminal neutral error from the last target and emits exactly one failover_decision', async () => {
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
    const composite = failoverProvider([t1.target, t2.target], undefined, { emit: rec.emit, ...makeFakeClock() });

    const req = composite.serializeRequest({ shadowTranscript: userTranscript(), input: undefined });
    const result = await composite.complete(req);

    expect(result.kind).toBe('error');
    expect(result.status).toBe(503);
    expect(result.message).toBe('unavailable-2');

    expect(t1.calls.complete).toHaveLength(1);
    expect(t2.calls.complete).toHaveLength(1);

    expect(rec.customEventsBySubtype('failover_decision')).toHaveLength(1);
    expect(rec.customEventsBySubtype('route_usage')).toHaveLength(0);
  });
});
