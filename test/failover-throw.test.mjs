// Golden (g): a target whose `complete` THROWS (rather than returning
// a `{kind:'error'}` neutral shape) no longer bypasses failover. The
// composite catches every thrown value, normalizes it to a retryable
// transport error with the original preserved in `cause`, and routes
// it through the same failure-class map — which means failover, then
// success at the next viable target.
//
// This is the moat-hole the first pilot found: real adapters throw
// exactly at the boundaries that need failover most (a non-ok HTTP
// response in the Anthropic port). A failover library that only fails
// over on returned errors has a hole precisely where adapters are
// least disciplined.
//
// Plus the throw↔chain-exhaustion interaction: when EVERY target throws,
// the composite returns the same `retryable:false` terminal shape 0.2.0
// introduced for returned-error exhaustion, with the cause chain intact.

import { describe, it, expect } from 'vitest';
import { createTarget, failoverProvider } from '../src/index.mjs';
import { makeMockTarget, makeRecorder, makeFakeClock, userTranscript, ok } from './_harness.mjs';

function makeThrowingTarget({ name, provider, model, error, openaiStateless = provider === 'openai' ? true : undefined }) {
  const calls = { serializeRequest: [], complete: [] };
  return {
    target: createTarget({
      name,
      provider,
      model,
      serializeRequest: (args) => { calls.serializeRequest.push(args); return { apiKey: 'k', baseUrl: 'm', body: {} }; },
      complete: async (req) => { calls.complete.push(req); throw error; },
      computeCostUsd: () => 0,
      ...(openaiStateless !== undefined ? { openaiStateless } : {}),
    }),
    calls,
  };
}

describe('throw-bypass: a thrown error triggers failover (not bypass)', () => {
  it('catches the throw, fails over to the healthy target, emits a decision with the throw reflected', async () => {
    const throwError = new TypeError('fetch failed');
    const t1 = makeThrowingTarget({
      name: 'anthropic-opus',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      error: throwError,
    });
    const t2 = makeMockTarget({
      name: 'openai-gpt5',
      provider: 'openai',
      model: 'gpt-5.4',
      results: [ok({ text: 'recovered after throw' })],
    });
    const rec = makeRecorder();
    const composite = failoverProvider(
      [t1.target, t2.target],
      undefined,
      { emit: rec.emit, metrics: rec.metrics, ...makeFakeClock() },
    );

    const req = composite.serializeRequest({ shadowTranscript: userTranscript(), input: undefined });
    const result = await composite.complete(req);

    expect(result.kind).toBeUndefined();
    expect(result.text).toBe('recovered after throw');

    expect(t1.calls.complete).toHaveLength(1);
    expect(t2.calls.complete).toHaveLength(1);

    const decisions = rec.emitOf('failover_decision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      from: 'anthropic-opus',
      to: 'openai-gpt5',
      reason: expect.stringContaining('stage:transport'),
    });
  });

  it('a chain where every target throws exhausts to retryable:false with the throw chain in cause', async () => {
    const error1 = new TypeError('network down on anthropic');
    const error2 = new Error('socket reset on openai');
    const t1 = makeThrowingTarget({
      name: 'anthropic-opus', provider: 'anthropic', model: 'claude-opus-4-8', error: error1,
    });
    const t2 = makeThrowingTarget({
      name: 'openai-gpt5', provider: 'openai', model: 'gpt-5.4', error: error2,
    });
    const rec = makeRecorder();
    const composite = failoverProvider(
      [t1.target, t2.target],
      undefined,
      { emit: rec.emit, metrics: rec.metrics, ...makeFakeClock() },
    );

    const req = composite.serializeRequest({ shadowTranscript: userTranscript(), input: undefined });
    const result = await composite.complete(req);

    expect(result.kind).toBe('error');
    expect(result.retryable).toBe(false);
    expect(result.stage).toBe('transport');
    expect(result.message).toContain('chain exhausted');
    expect(result.message).toContain('socket reset on openai');

    expect(result.cause).toBeDefined();
    expect(result.cause.kind).toBe('error');
    expect(result.cause.retryable).toBe(true);
    expect(result.cause.cause).toBe(error2);
  });
});
