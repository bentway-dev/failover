// Routing policy: classify each neutral error against the failure-class
// map and return one of three actions. A caller may pass a custom
// policy fn that overrides the default mapping case-by-case.

/** @typedef {import('./types.mjs').NeutralError} NeutralError */

/** Maximum delay (ms) honoured for a same-target 429 retry. A larger
 *  Retry-After triggers failover instead of waiting. */
export const MAX_429_BACKOFF_MS = 2000;

/** @typedef {'failover' | 'retry-same' | 'fail-fast'} Action */

/**
 * Classify a neutral error into the default action without consulting
 * any caller-supplied policy. The composite uses this when no policy
 * fn is supplied OR when the supplied policy returns a falsy value
 * (meaning "no override, use the default").
 *
 * Map:
 *   transport / 429+retryable               → retry-same (then failover if the retry fails)
 *   transport / 529 | 5xx | retryable-no-status → failover immediately
 *   transport / 4xx non-retryable           → fail-fast (no failover; misconfig won't fix elsewhere)
 *   completion / *                          → fail-fast in v1 (host's bad-completion hook owns redrive)
 *
 * @param {NeutralError} error
 * @returns {Action}
 */
export function defaultClassify(error) {
  if (error?.stage === 'completion') return 'fail-fast';

  if (error?.stage === 'transport') {
    if (error.retryable === false) return 'fail-fast';
    if (error.status === 429) return 'retry-same';
    if (error.status === 529) return 'failover';
    if (typeof error.status === 'number' && error.status >= 500 && error.status < 600) return 'failover';
    if (error.retryable === true) return 'failover';
    return 'fail-fast';
  }

  return 'fail-fast';
}

/**
 * Apply a (possibly-undefined) caller policy and fall back to the
 * default classifier. A caller policy returning `undefined`/`null`
 * means "I don't have an opinion here; use the default" — the cheapest
 * way to author a partial-override policy.
 *
 * @param {((error: NeutralError, target: object, history: object[]) => (Action | null | undefined)) | undefined} userPolicy
 * @param {NeutralError} error
 * @param {object} target
 * @param {object[]} history
 * @returns {Action}
 */
export function resolveAction(userPolicy, error, target, history) {
  if (typeof userPolicy === 'function') {
    const overridden = userPolicy(error, target, history);
    if (overridden === 'failover' || overridden === 'retry-same' || overridden === 'fail-fast') {
      return overridden;
    }
  }
  return defaultClassify(error);
}

/**
 * Compute the backoff delay for a 429 retry. If the neutral error
 * carries a status of 429 and the underlying message hints a
 * `Retry-After`-style hold, use it (capped at MAX_429_BACKOFF_MS). The
 * adapters do not surface `Retry-After` as a structured field in
 * 0.3.0; we parse a small number of seconds from the message when the
 * provider includes one, falling back to a 250ms baseline otherwise.
 *
 * Returns `null` when the retry should be abandoned in favour of
 * failover (the suggested delay exceeded the cap).
 *
 * @param {NeutralError} error
 * @returns {number | null}
 */
export function computeBackoffMs(error) {
  const msg = typeof error?.message === 'string' ? error.message : '';
  const m = msg.match(/retry[- ]?after[^0-9]*(\d+(?:\.\d+)?)\s*(s|sec|seconds?|ms)?/i);
  if (m) {
    const value = Number(m[1]);
    const unit = (m[2] || 's').toLowerCase();
    const ms = unit === 'ms' ? value : value * 1000;
    if (ms > MAX_429_BACKOFF_MS) return null;
    return Math.max(0, ms);
  }
  return 250;
}

/**
 * Pick the next un-tried target from the chain. Iteration order is the
 * chain's declared order; a target appears in `history` after it has
 * been tried and failed at least once. Returns `null` when the chain
 * is exhausted (the composite then returns the terminal error
 * unchanged).
 *
 * @param {Array<{ name: string }>} chain
 * @param {Array<{ target: string }>} history
 * @returns {{ name: string } | null}
 */
export function pickNextTarget(chain, history) {
  const tried = new Set(history.map((h) => h.target));
  for (const t of chain) {
    if (!tried.has(t.name)) return t;
  }
  return null;
}
