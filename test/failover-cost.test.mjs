// Golden (d): cost-correctness under mixed-target sessions.
// computeTotalCostUsd must return the sum of each target's own cost fn
// applied to its own accumulated usage — NOT one model's pricing on
// combined usage (which is what the kernel's single-session-model
// arithmetic would produce). This is the only number that means
// anything to a cost-controlling host.

import { describe, it, expect } from 'vitest';
import { failoverProvider } from '../src/index.mjs';
import { makeMockTarget, makeRecorder, makeFakeClock, userTranscript, ok, err } from './_harness.mjs';

describe('cost correctness across a mixed-target session', () => {
  it('sums per-target costs from each target\'s own cost fn', async () => {
    const t1 = makeMockTarget({
      name: 'anthropic-opus',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      results: [
        ok({ usage: { input_tokens: 1000, output_tokens: 50 } }),
        err({ status: 529, retryable: true }),
      ],
      costPerInputToken: 0.005,
    });
    const t2 = makeMockTarget({
      name: 'openai-gpt5',
      provider: 'openai',
      model: 'gpt-5.4',
      results: [
        ok({ usage: { input_tokens: 2000, output_tokens: 100 } }),
      ],
      costPerInputToken: 0.0025,
    });
    const rec = makeRecorder();
    const composite = failoverProvider([t1.target, t2.target], undefined, { emit: rec.emit, ...makeFakeClock() });

    const req1 = composite.serializeRequest({ shadowTranscript: userTranscript('q1'), input: undefined });
    const r1 = await composite.complete(req1);
    expect(r1.text).toBeDefined();

    const req2 = composite.serializeRequest({ shadowTranscript: userTranscript('q2'), input: undefined });
    const r2 = await composite.complete(req2);
    expect(r2.text).toBeDefined();

    const expectedT1Cost = 1000 * 0.005;
    const expectedT2Cost = 2000 * 0.0025;
    const expectedTotal = expectedT1Cost + expectedT2Cost;

    const total = composite.computeTotalCostUsd('claude-opus-4-8', { input_tokens: 3000, output_tokens: 150 });
    expect(total).toBeCloseTo(expectedTotal, 10);

    const routes = rec.customEventsBySubtype('route_usage');
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({ target: 'anthropic-opus', cost_usd: expectedT1Cost });
    expect(routes[1]).toMatchObject({ target: 'openai-gpt5',  cost_usd: expectedT2Cost });
  });
});
