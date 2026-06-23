// Public surface of @bentway/failover.
//
// Two factories — `createTarget` for the per-provider unit and
// `failoverProvider` for the composite that satisfies the kernel's
// {serializeRequest, complete, computeTotalCostUsd} ctx contract — plus
// the default failure-class classifier so a caller can layer a custom
// policy on top without re-deriving the defaults.

export { createTarget } from './target.mjs';
export { failoverProvider, defaultClassify } from './failover.mjs';

/**
 * The composite chain unit. Frozen at construction.
 * @typedef {import('./target.mjs').Target} Target
 *
 * @typedef {import('./target.mjs').TargetCapabilities} TargetCapabilities
 *
 * The action a policy resolves to for a given neutral error.
 * @typedef {'failover' | 'retry-same' | 'fail-fast'} Action
 *
 * @typedef {import('./types.mjs').PortResult} PortResult
 * @typedef {import('./types.mjs').NeutralError} NeutralError
 * @typedef {import('./types.mjs').Usage} Usage
 * @typedef {import('./types.mjs').Transcript} Transcript
 * @typedef {import('./types.mjs').Message} Message
 * @typedef {import('./types.mjs').Block} Block
 * @typedef {import('./types.mjs').SerializeRequestFn} SerializeRequestFn
 * @typedef {import('./types.mjs').CompleteFn} CompleteFn
 * @typedef {import('./types.mjs').ComputeCostUsdFn} ComputeCostUsdFn
 * @typedef {import('./types.mjs').EmitFn} EmitFn
 * @typedef {import('./types.mjs').CompletionRequest} CompletionRequest
 */

export {};
