// Test harness: factory builders for mock targets, a recording emit
// sink, a deterministic fake clock, and a tiny user-transcript builder.
// Imported by every golden in this directory.

import { createTarget } from '../src/index.mjs';

/**
 * Build a Target whose `complete` returns the next result from a
 * scripted queue. `serializeRequest` is a spy: its calls are recorded
 * in `calls.serializeRequest`. `complete` is also spied in
 * `calls.complete`.
 */
export function makeMockTarget({
  name,
  provider,
  model,
  results,
  costPerInputToken = 0.001,
  openaiStateless = provider === 'openai' ? true : undefined,
}) {
  const queue = [...results];
  const calls = { serializeRequest: [], complete: [] };
  const serializeRequest = (args) => {
    calls.serializeRequest.push(args);
    return {
      apiKey: 'k',
      baseUrl: 'http://mock',
      body: { provider, model, transcript: args.shadowTranscript },
    };
  };
  const complete = async (req) => {
    calls.complete.push(req);
    if (queue.length === 0) {
      throw new Error(`mockTarget '${name}': no more scripted results`);
    }
    return queue.shift();
  };
  const computeCostUsd = (m, usage) => {
    const inputTokens = (usage && usage.input_tokens) || 0;
    return inputTokens * costPerInputToken;
  };
  const target = createTarget({
    name,
    provider,
    model,
    serializeRequest,
    complete,
    computeCostUsd,
    ...(openaiStateless !== undefined ? { openaiStateless } : {}),
  });
  return { target, calls };
}

/** Recording emit sink + the events it captured. */
export function makeRecorder() {
  const events = [];
  const emit = (e) => { events.push(e); };
  const customEventsBySubtype = (subtype) =>
    events
      .filter((e) => e.tag === 'customEvent' && e.subtype === subtype)
      .map((e) => ({ tag: e.tag, subtype: e.subtype, ...(e.fields || {}) }));
  return { emit, events, customEventsBySubtype };
}

/** Deterministic clock that advances on demand. */
export function makeFakeClock(initial = 1000) {
  let now = initial;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
    sleep: async (_ms) => {},
  };
}

/** Minimal neutral transcript with one user message. */
export function userTranscript(text = 'hello') {
  return {
    messages: [
      { role: 'user', content: [{ type: 'text', text }] },
    ],
  };
}

/** Add an Anthropic-reasoning block in front of an assistant message. */
export function transcriptWithAnthropicReasoning(userText, reasoningPayload, assistantText) {
  return {
    messages: [
      { role: 'user', content: [{ type: 'text', text: userText }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', provider: 'anthropic', payload: reasoningPayload },
          { type: 'text', text: assistantText },
        ],
      },
    ],
  };
}

/** A PortResult success. */
export function ok({ text = '', usage = { input_tokens: 10, output_tokens: 5 }, id }) {
  return {
    text,
    calls: [],
    reasoning: [],
    phase: undefined,
    stopReason: 'end_turn',
    usage,
    ...(id !== undefined ? { id } : {}),
  };
}

/** A neutral error. */
export function err({ stage = 'transport', status, message = 'mock error', retryable = false, requestFailed }) {
  return {
    kind: 'error',
    stage,
    retryable,
    ...(status !== undefined ? { status } : {}),
    ...(requestFailed !== undefined ? { requestFailed } : {}),
    message,
    stopReason: 'error',
  };
}
