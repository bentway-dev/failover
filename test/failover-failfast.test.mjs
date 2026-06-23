// Golden (c): non-retryable transport errors (auth, malformed headers,
// other 4xx) must NOT trigger failover — those failures don't fix
// themselves on a different target. The terminal error returns
// unchanged; no failover_decision emitted; the second target's complete
// is never called.

import { describe, it, expect } from 'vitest';
import { failoverProvider } from '../src/index.mjs';
import { makeMockTarget, makeRecorder, makeFakeClock, userTranscript, ok, err } from './_harness.mjs';

describe('fail-fast: 4xx non-retryable', () => {
  it('returns the terminal error unchanged and never calls target 2', async () => {
    const t1 = makeMockTarget({
      name: 'anthropic-opus',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      results: [err({ status: 401, retryable: false, message: 'invalid api key' })],
    });
    const t2 = makeMockTarget({
      name: 'openai-gpt5',
      provider: 'openai',
      model: 'gpt-5.4',
      results: [ok({ text: 'should never reach here' })],
    });
    const rec = makeRecorder();
    const composite = failoverProvider([t1.target, t2.target], undefined, { emit: rec.emit, ...makeFakeClock() });

    const req = composite.serializeRequest({ shadowTranscript: userTranscript(), input: undefined });
    const result = await composite.complete(req);

    expect(result.kind).toBe('error');
    expect(result.status).toBe(401);

    expect(t2.calls.serializeRequest).toHaveLength(0);
    expect(t2.calls.complete).toHaveLength(0);

    expect(rec.customEventsBySubtype('failover_decision')).toHaveLength(0);
    expect(rec.customEventsBySubtype('route_usage')).toHaveLength(0);
  });
});
