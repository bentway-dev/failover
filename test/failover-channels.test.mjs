// Golden (f): the two-channel event model.
//
// On the happy path (first target succeeds, no failover, no
// degradation), the composite emits NOTHING to `emit` — wiring the
// stream sink is byte-transparent until a real failover occurs. This is
// the property an adopter's stream-equivalence gate depends on.
//
// Per-call telemetry (`route_usage`) lands on the SEPARATE `metrics`
// hook so it never touches the conversation stream.
//
// On an actual failover (529 → next target), the decision event lands
// on `emit`; the eventual successful call's telemetry still lands on
// `metrics` only. The two channels are independent.

import { describe, it, expect } from 'vitest';
import { failoverProvider } from '../src/index.mjs';
import { makeMockTarget, makeRecorder, makeFakeClock, userTranscript, ok, err } from './_harness.mjs';

describe('two-channel event routing', () => {
  it('happy path: emit receives nothing; metrics receives route_usage', async () => {
    const t1 = makeMockTarget({
      name: 'anthropic-opus',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      results: [ok({ usage: { input_tokens: 50, output_tokens: 10 } })],
    });
    const t2 = makeMockTarget({
      name: 'openai-gpt5',
      provider: 'openai',
      model: 'gpt-5.4',
      results: [ok({ text: 'unused' })],
    });
    const rec = makeRecorder();
    const composite = failoverProvider([t1.target, t2.target], undefined, { emit: rec.emit, metrics: rec.metrics, ...makeFakeClock() });

    const req = composite.serializeRequest({ shadowTranscript: userTranscript(), input: undefined });
    const result = await composite.complete(req);
    expect(result.text).toBeDefined();

    expect(rec.emitEvents).toHaveLength(0);

    expect(rec.metricsOf('route_usage')).toHaveLength(1);
    expect(rec.metricsOf('route_usage')[0]).toMatchObject({ target: 'anthropic-opus' });
  });

  it('failover path: decision lands on emit, telemetry stays on metrics', async () => {
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
      results: [ok({ text: 'served by openai' })],
    });
    const rec = makeRecorder();
    const composite = failoverProvider([t1.target, t2.target], undefined, { emit: rec.emit, metrics: rec.metrics, ...makeFakeClock() });

    const req = composite.serializeRequest({ shadowTranscript: userTranscript(), input: undefined });
    await composite.complete(req);

    expect(rec.emitOf('failover_decision')).toHaveLength(1);
    expect(rec.emitOf('route_usage')).toHaveLength(0);

    expect(rec.metricsOf('route_usage')).toHaveLength(1);
    expect(rec.metricsOf('failover_decision')).toHaveLength(0);
  });

  it('both hooks optional: composite runs without emit or metrics wired', async () => {
    const t1 = makeMockTarget({
      name: 'anthropic-opus',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      results: [ok({ text: 'no observability needed' })],
    });
    const composite = failoverProvider([t1.target], undefined, makeFakeClock());

    const req = composite.serializeRequest({ shadowTranscript: userTranscript(), input: undefined });
    const result = await composite.complete(req);
    expect(result.text).toBe('no observability needed');
  });
});
