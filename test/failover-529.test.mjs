// Golden (a): the headline trust claim — when target 1 fails with a
// transient overload (Anthropic 529), the composite picks target 2,
// re-serializes the SAME neutral transcript for it, completes the call,
// and emits a failover_decision the host can observe. The kernel never
// knows a failover happened.

import { describe, it, expect } from 'vitest';
import { failoverProvider } from '../src/index.mjs';
import { makeMockTarget, makeRecorder, makeFakeClock, userTranscript, ok, err } from './_harness.mjs';

describe('529 failover: anthropic → openai (stateless)', () => {
  it('re-serializes the same transcript for target 2 and returns its success', async () => {
    const t1 = makeMockTarget({
      name: 'anthropic-opus',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      results: [err({ status: 529, retryable: true, message: 'overloaded' })],
    });
    const t2 = makeMockTarget({
      name: 'openai-gpt5',
      provider: 'openai',
      model: 'gpt-5.4',
      results: [ok({ text: 'served by openai', usage: { input_tokens: 100, output_tokens: 20 } })],
    });
    const rec = makeRecorder();
    const clock = makeFakeClock();
    const composite = failoverProvider([t1.target, t2.target], undefined, { emit: rec.emit, ...clock });

    const transcript = userTranscript('explain HRV');
    const req = composite.serializeRequest({ shadowTranscript: transcript, input: undefined });

    const result = await composite.complete(req);

    expect(t1.calls.complete).toHaveLength(1);
    expect(t2.calls.serializeRequest).toHaveLength(1);
    expect(t2.calls.complete).toHaveLength(1);

    expect(t2.calls.serializeRequest[0].shadowTranscript).toBe(transcript);

    expect(result.kind).toBeUndefined();
    expect(result.text).toBe('served by openai');

    const decisions = rec.customEventsBySubtype('failover_decision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subtype: 'failover_decision',
      from: 'anthropic-opus',
      to: 'openai-gpt5',
      reason: expect.stringContaining('status:529'),
      attempt: 2,
    });

    const routes = rec.customEventsBySubtype('route_usage');
    expect(routes).toHaveLength(1);
    expect(routes[0].target).toBe('openai-gpt5');
  });
});
