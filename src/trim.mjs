// Transcript trim — the fidelity-degradation seam.
//
// The kernel's `serializeFor<X>` functions assume each reasoning block's
// `provider` tag matches the target X. Cross-provider failover violates
// this assumption: an Anthropic thinking block re-serialized via
// `serializeForOpenAI` produces a wire-level error; via
// `serializeForLlama` it silently corrupts `reasoning_content`. The
// fix is to strip `reasoning` blocks whose `provider` doesn't match the
// new target BEFORE the kernel serializer runs.
//
// The text block's optional `phase` field is also dropped — the other
// serializers ignore it anyway, but stripping it explicitly makes the
// degradation observable.
//
// Signed-thinking → encrypted-reasoning translation is semantically
// impossible (different cryptographic envelopes); the library never
// attempts it. The host learns from the `failover_degradation` event
// what was lost.

/** @typedef {import('./types.mjs').Transcript} Transcript */

/**
 * Return a copy of `transcript` with cross-provider artifacts removed
 * for the target provider. Together with `dropped`, names what was
 * trimmed — a set of strings the `failover_degradation` event consumes.
 *
 * Returns the original transcript object unchanged when nothing
 * trimmed, so the common-case (same-provider retry, no foreign
 * artifacts) is allocation-free.
 *
 * @param {Transcript} transcript
 * @param {'anthropic' | 'openai' | 'llama'} targetProvider
 * @returns {{ transcript: Transcript, dropped: string[] }}
 */
export function trimForTarget(transcript, targetProvider) {
  const dropped = new Set();
  let mutated = false;

  const newMessages = transcript.messages.map((msg) => {
    let messageMutated = false;
    const newContent = [];
    for (const block of msg.content) {
      if (block.type === 'reasoning' && block.provider !== targetProvider) {
        dropped.add(`reasoning:${block.provider}`);
        messageMutated = true;
        continue;
      }
      if (block.type === 'text' && block.phase !== undefined) {
        const { phase: _phase, ...rest } = block;
        newContent.push(rest);
        dropped.add('phase');
        messageMutated = true;
        continue;
      }
      newContent.push(block);
    }
    if (messageMutated) {
      mutated = true;
      return { ...msg, content: newContent };
    }
    return msg;
  });

  if (!mutated) return { transcript, dropped: [] };
  return { transcript: { messages: newMessages }, dropped: [...dropped] };
}
