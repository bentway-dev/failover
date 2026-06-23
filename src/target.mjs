// createTarget — the unit of the failover chain. Holds the adapter
// triple (serializeRequest, complete, computeCostUsd), the
// provider+model tag, and an optional capability descriptor the
// library defines (the kernel does not expose capability metadata in
// 0.3.0).
//
// One assertion: an OpenAI target must declare `openaiStateless: true`,
// affirming the caller built its `serializeRequest` via
// `makeOpenAiSerializeRequest({ stateless: true, ... })`. The stateful
// flow threads `previous_response_id` across turns, which the kernel's
// loop forwards verbatim — failing over to another provider mid-loop
// would lose the chain. The assertion is opt-in (we can't introspect
// the function), but the failure message points at the exact fix.

/** @typedef {import('./types.mjs').SerializeRequestFn} SerializeRequestFn */
/** @typedef {import('./types.mjs').CompleteFn} CompleteFn */
/** @typedef {import('./types.mjs').ComputeCostUsdFn} ComputeCostUsdFn */

/**
 * @typedef {{
 *   contextWindow?: number,
 *   supportsNativeTools?: boolean,
 *   supportsThinking?: boolean,
 *   supportsVision?: boolean,
 * }} TargetCapabilities
 *
 * @typedef {{
 *   readonly name: string,
 *   readonly provider: 'anthropic' | 'openai' | 'llama',
 *   readonly model: string,
 *   readonly serializeRequest: SerializeRequestFn,
 *   readonly complete: CompleteFn,
 *   readonly computeCostUsd: ComputeCostUsdFn,
 *   readonly capabilities: TargetCapabilities,
 * }} Target
 */

const VALID_PROVIDERS = new Set(['anthropic', 'openai', 'llama']);

/**
 * @param {{
 *   name: string,
 *   provider: 'anthropic' | 'openai' | 'llama',
 *   model: string,
 *   serializeRequest: SerializeRequestFn,
 *   complete: CompleteFn,
 *   computeCostUsd: ComputeCostUsdFn,
 *   capabilities?: TargetCapabilities,
 *   openaiStateless?: boolean,
 * }} args
 * @returns {Target}
 */
export function createTarget(args) {
  const { name, provider, model, serializeRequest, complete, computeCostUsd, capabilities, openaiStateless } = args ?? {};

  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('createTarget: `name` must be a non-empty string');
  }
  if (!VALID_PROVIDERS.has(provider)) {
    throw new TypeError(`createTarget: \`provider\` must be one of 'anthropic' | 'openai' | 'llama' (got ${JSON.stringify(provider)})`);
  }
  if (typeof model !== 'string' || model.length === 0) {
    throw new TypeError('createTarget: `model` must be a non-empty string');
  }
  if (typeof serializeRequest !== 'function') {
    throw new TypeError(`createTarget: target '${name}' \`serializeRequest\` must be a function`);
  }
  if (typeof complete !== 'function') {
    throw new TypeError(`createTarget: target '${name}' \`complete\` must be a function`);
  }
  if (typeof computeCostUsd !== 'function') {
    throw new TypeError(`createTarget: target '${name}' \`computeCostUsd\` must be a function`);
  }

  if (provider === 'openai' && openaiStateless !== true) {
    throw new Error(
      `createTarget: OpenAI target '${name}' requires \`openaiStateless: true\`, and the underlying ` +
      `\`serializeRequest\` must be built via \`makeOpenAiSerializeRequest({ stateless: true, ... })\`. ` +
      `Stateful mode threads \`previous_response_id\` across turns, which breaks under failover.`,
    );
  }

  return Object.freeze({
    name,
    provider,
    model,
    serializeRequest,
    complete,
    computeCostUsd,
    capabilities: Object.freeze({ ...(capabilities ?? {}) }),
  });
}
