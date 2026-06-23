// Locally-authored ambient types for kernel surfaces that `@bentway/core
// 0.3.0` and the adapter packages do not export as typed shapes.
//
// Every typedef here exists because the corresponding public-API report
// (`packages/*/etc/*.api.md` in the bentway repo) declared the surface
// as `any` or as a structurally-loose object. The library consumes
// these surfaces in strictly-typed code; without local typedefs the
// JSDoc inference dissolves into `any` and the gate stops catching
// shape regressions.
//
// This is the concrete inventory backing the deferred kernel-types
// review — each typedef is one item the kernel could publish in a
// future version to remove a local duplicate.

/**
 * Provider-neutral content blocks the kernel's Transcript carries.
 * The kernel exports these block constructors from
 * `@bentway/core/transcript` but the api-extractor report does not
 * type the return values precisely.
 *
 * @typedef {{ type: 'text', text: string, phase?: string }} TextBlock
 * @typedef {{ type: 'tool_use', id: string, name: string, input: Record<string, unknown> }} ToolUseBlock
 * @typedef {{ type: 'tool_result', tool_use_id: string, content: string | object[], is_error?: boolean }} ToolResultBlock
 * @typedef {{ type: 'reasoning', provider: string, payload: string }} ReasoningBlock
 * @typedef {TextBlock | ToolUseBlock | ToolResultBlock | ReasoningBlock} Block
 *
 * @typedef {{ role: 'system' | 'user' | 'assistant', content: Block[] }} Message
 * @typedef {{ messages: Message[] }} Transcript
 */

/**
 * The provider-neutral success shape every adapter's `complete()`
 * resolves to. Lives as a JSDoc `@typedef` in
 * `@bentway/openai/src/openai.mjs` but is not exported as a TS type
 * (the api-extractor report shows the loop's ctx as `any`, so the
 * loop's reader of `PortResult` has no static check either).
 *
 * @typedef {{
 *   input_tokens?: number,
 *   output_tokens?: number,
 *   input_tokens_details?: { cached_tokens?: number, cache_creation_tokens?: number },
 *   output_tokens_details?: { reasoning_tokens?: number }
 * }} Usage
 *
 * @typedef {{
 *   text: string,
 *   calls: Array<{ callId: string, name: string, arguments: Record<string, unknown> }>,
 *   reasoning: string[],
 *   phase: string | undefined,
 *   stopReason: string | undefined,
 *   usage: Usage,
 *   id?: string,
 *   textChunks?: string[],
 * }} PortResult
 */

/**
 * The provider-neutral error shape every adapter's `complete()`
 * resolves to on an expected transport- or completion-stage failure.
 * Not exported as a TS type by any bentway package.
 *
 * @typedef {{
 *   kind: 'error',
 *   stage: 'transport' | 'completion',
 *   retryable: boolean,
 *   status?: number,
 *   message: string,
 *   stopReason?: string,
 *   requestFailed?: boolean,
 *   textChunks?: string[],
 * }} NeutralError
 */

/**
 * The serialize-request seam the loop consumes. Each adapter exports
 * a factory (`makeAnthropicSerializeRequest`, `makeOpenAiSerializeRequest`)
 * but the returned function is not typed in the api-extractor reports.
 *
 * @typedef {{ apiKey: string, baseUrl: string, body: object }} CompletionRequest
 *
 * @callback SerializeRequestFn
 * @param {{ shadowTranscript: Transcript, input: unknown, previousResponseId?: string }} args
 * @returns {CompletionRequest}
 *
 * @callback CompleteFn
 * @param {CompletionRequest} req
 * @returns {Promise<PortResult | NeutralError>}
 *
 * @callback ComputeCostUsdFn
 * @param {string} model
 * @param {Usage} usage
 * @returns {number}
 *
 * @callback EmitFn
 * @param {object} event
 * @returns {void}
 *
 * Receiver for the per-call telemetry events the composite produces on
 * the happy path (`route_usage` per successful call) and at teardown
 * (`failover_summary`). Routed to a separate hook from `EmitFn` so per-
 * call telemetry never lands on the conversation stream. Structurally
 * identical to `EmitFn`; the type alias is the contract.
 *
 * @callback MetricsFn
 * @param {object} event
 * @returns {void}
 */

export {};
