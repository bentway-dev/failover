// Golden (b): cross-provider failover with a transcript carrying an
// Anthropic reasoning block. The library must strip the foreign
// reasoning before serializing for OpenAI (else the wire-level injection
// would 400 in a real adapter), and must emit a failover_degradation
// event recording what was dropped.

import { describe, it, expect } from 'vitest';
import { failoverProvider } from '../src/index.mjs';
import {
  makeMockTarget, makeRecorder, makeFakeClock,
  transcriptWithAnthropicReasoning, ok, err,
} from './_harness.mjs';

describe('reasoning-trim degradation: anthropic-reasoning → openai', () => {
  it('strips anthropic reasoning blocks before openai serialization and reports the drop', async () => {
    const t1 = makeMockTarget({
      name: 'anthropic-opus',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      results: [err({ status: 529, retryable: true })],
    });
    const t2 = makeMockTarget({
      name: 'openai-gpt5',
      provider: 'openai',
      model: 'gpt-5.4',
      results: [ok({ text: 'recovered' })],
    });
    const rec = makeRecorder();
    const composite = failoverProvider([t1.target, t2.target], undefined, { emit: rec.emit, ...makeFakeClock() });

    const transcript = transcriptWithAnthropicReasoning(
      'what does the data say?',
      '{"type":"thinking","thinking":"...","signature":"abc"}',
      'short answer',
    );
    const req = composite.serializeRequest({ shadowTranscript: transcript, input: undefined });

    await composite.complete(req);

    const t2Transcript = t2.calls.serializeRequest[0].shadowTranscript;
    const blockTypes = t2Transcript.messages
      .flatMap((m) => m.content.map((b) => b.type));
    expect(blockTypes).not.toContain('reasoning');
    expect(t2Transcript).not.toBe(transcript);

    const degradations = rec.customEventsBySubtype('failover_degradation');
    expect(degradations).toHaveLength(1);
    expect(degradations[0]).toMatchObject({
      subtype: 'failover_degradation',
      target: 'openai-gpt5',
      dropped: ['reasoning:anthropic'],
    });
  });
});
