// failoverProvider — the composite that satisfies the kernel's
// {serializeRequest, complete, computeTotalCostUsd} ctx contract by
// driving N real Targets behind one chain + policy.
//
// The mechanism, in one paragraph: `serializeRequest` stashes its raw
// inputs and builds the request for the current target. `complete` runs
// the call. On success it accumulates per-target usage and emits a
// `route_usage` event to the metrics channel. On a routed error — OR a
// THROW from the underlying adapter — it consults the policy, picks the
// next viable target, re-serializes the stashed transcript for that
// target, emits a `failover_decision` to the stream-events channel, and
// re-calls `complete` internally — repeating until success, fail-fast,
// or chain exhaustion. The kernel sees ONE logical call per turn;
// transcript portability is automatic because every internal re-call
// re-serializes the full neutral transcript via the new target's
// adapter.
//
// Throw normalization. An adapter that throws (rather than returning a
// `{kind:'error'}` neutral shape) used to bypass failover entirely — the
// exception would unwind through the kernel. Real adapters throw exactly
// at the boundaries that need failover most (a non-ok HTTP response in
// the Anthropic port surfaced this in the pilot). The composite now
// catches every thrown value, normalizes it to a retryable transport
// error with the original preserved in `cause`, and lets it flow through
// the same failure-class map. Conservative by design: every throw → one
// retryable failover attempt. Transient throws (network) fail over and
// succeed; systematic bugs (every target throws) exhaust the chain and
// surface as `retryable:false` with the cause chain intact — the same
// terminal shape 0.2.0 introduced for returned-error exhaustion.
//
// Two-channel event model. The composite has two separate observation
// surfaces, both optional with no-op defaults:
//   - `emit`    — the stream sink. Receives ONLY decision events
//                 (`failover_decision`, `failover_degradation`). Both
//                 only fire when something actually happens (a failover
//                 or a cross-provider trim). The happy path — first
//                 target succeeds, no degradation — sends NOTHING to
//                 `emit`. Wiring `emit` is byte-transparent to the
//                 stream until a real failover occurs.
//   - `metrics` — telemetry. Receives the per-call `route_usage` event
//                 on every successful call, plus the optional
//                 `failover_summary` rollup at teardown. Routed to a
//                 separate hook so per-call telemetry never lands on
//                 the conversation stream.
//
// Chain-level retry contract. The composite owns the entire failover /
// retry / backoff strategy for routed errors. On chain exhaustion it
// returns a `retryable:false` terminal error wrapping the underlying
// failure in `cause`. The host loop MUST NOT layer its own retry on top
// of this — doing so would re-enter the composite at `targets[0]` and
// re-run the whole chain (retry amplification under a multi-provider
// outage). Per-target transient errors are handled internally and
// never surface; only the final terminal result reaches the host.
//
// Cost derivation. The per-target ledger accumulates USAGE (integer
// tokens, no float drift), not running cost. `computeTotalCostUsd` and
// `summary` compute cost once per target from the accumulated usage,
// then sum across targets. A single-target chain therefore yields
// byte-identical cost to a baseline that runs that target alone — the
// transparency property an adopter's stream-equivalence gate depends on.

import { accumulateUsage } from '@bentway/core/usage';
import { trimForTarget } from './trim.mjs';
import {
  resolveAction,
  computeBackoffMs,
  pickNextTarget,
  defaultClassify,
} from './policy.mjs';
import {
  failoverDecision,
  routeUsage,
  failoverDegradation,
  failoverSummary,
} from './events.mjs';

/** @typedef {import('./types.mjs').PortResult} PortResult */
/** @typedef {import('./types.mjs').NeutralError} NeutralError */
/** @typedef {import('./types.mjs').Usage} Usage */
/** @typedef {import('./types.mjs').EmitFn} EmitFn */
/** @typedef {import('./types.mjs').MetricsFn} MetricsFn */
/** @typedef {import('./target.mjs').Target} Target */

/** @typedef {'failover' | 'retry-same' | 'fail-fast'} Action */

/**
 * @typedef {{
 *   target: Target,
 *   stash: { shadowTranscript: object, input: unknown, previousResponseId?: string },
 *   history: Array<{ target: string, reason: string }>,
 *   retriedSameTarget: boolean,
 *   lastCallStart: number,
 * }} CallState
 */

const noop = () => {};

/**
 * Normalize a thrown value from an adapter's `complete` into the
 * neutral error shape so the existing failure-class map can route it.
 * Conservative: every throw → `transport`/`retryable:true`. The
 * original throwable is preserved in `cause` so a systematic adapter
 * bug (which will exhaust the chain) surfaces with diagnosable detail
 * intact, while a transient throw merely fails over.
 */
function normalizeThrow(thrown) {
  return {
    kind: 'error',
    stage: 'transport',
    retryable: true,
    message: (thrown && thrown.message) ? thrown.message : String(thrown),
    cause: thrown,
  };
}

/**
 * @param {Target[]} targets
 * @param {((error: NeutralError, target: Target, history: object[]) => (Action | null | undefined)) | undefined} policy
 * @param {{ emit?: EmitFn, metrics?: MetricsFn, now?: () => number, sleep?: (ms: number) => Promise<void> }} [hooks]
 * @returns {{
 *   serializeRequest: (args: { shadowTranscript: object, input: unknown, previousResponseId?: string }) => object,
 *   complete: (req: object) => Promise<PortResult | NeutralError>,
 *   computeTotalCostUsd: (model: string, usage: Usage) => number,
 *   summary: () => void,
 * }}
 */
export function failoverProvider(targets, policy, hooks = {}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new TypeError('failoverProvider: `targets` must be a non-empty array');
  }
  const seen = new Set();
  for (const t of targets) {
    if (!t || typeof t.name !== 'string') {
      throw new TypeError('failoverProvider: every target must be a Target object from createTarget()');
    }
    if (seen.has(t.name)) {
      throw new Error(`failoverProvider: duplicate target name '${t.name}' — names must be unique within a chain`);
    }
    seen.add(t.name);
  }

  const emit = typeof hooks.emit === 'function' ? hooks.emit : noop;
  const metrics = typeof hooks.metrics === 'function' ? hooks.metrics : noop;
  const now = typeof hooks.now === 'function' ? hooks.now : Date.now;
  const sleep = typeof hooks.sleep === 'function'
    ? hooks.sleep
    : (ms) => new Promise((r) => setTimeout(r, ms));

  /** @type {Map<string, { usage: Usage, callCount: number, totalLatencyMs: number }>} */
  const ledger = new Map();
  for (const t of targets) {
    ledger.set(t.name, { usage: {}, callCount: 0, totalLatencyMs: 0 });
  }
  let failoverCount = 0;

  /** @type {CallState | null} */
  let active = null;

  function buildRequestFor(target, stash) {
    const { transcript: trimmed, dropped } = trimForTarget(stash.shadowTranscript, target.provider);
    if (dropped.length > 0) {
      emit(failoverDegradation({ target: target.name, dropped }));
    }
    return target.serializeRequest({
      shadowTranscript: trimmed,
      input: stash.input,
      previousResponseId: stash.previousResponseId,
    });
  }

  function attributeSuccess(target, result, durationMs) {
    const entry = ledger.get(target.name);
    if (!entry) return;
    const turnUsage = result.usage ?? {};
    entry.usage = accumulateUsage(entry.usage, turnUsage);
    entry.callCount += 1;
    entry.totalLatencyMs += durationMs;
    // Per-call cost is one float multiplication on the turn's own
    // usage — emitted on the route_usage event for granular dashboards.
    // The session total is NOT derived by summing these floats (drift);
    // see computeTotalCostUsd which recomputes from accumulated usage.
    const turnCost = target.computeCostUsd(target.model, turnUsage);
    metrics(routeUsage({
      target: target.name,
      model: target.model,
      usage: turnUsage,
      cost_usd: Number.isFinite(turnCost) ? turnCost : 0,
      latency_ms: durationMs,
    }));
  }

  function errorReasonString(err) {
    const parts = [];
    if (err && typeof err.status === 'number') parts.push(`status:${err.status}`);
    if (err && typeof err.stage === 'string') parts.push(`stage:${err.stage}`);
    if (err && err.retryable === false) parts.push('non-retryable');
    return parts.join(',') || 'unknown';
  }

  function chainExhaustedError(underlying) {
    return {
      kind: 'error',
      stage: underlying.stage,
      retryable: false,
      ...(underlying.status !== undefined ? { status: underlying.status } : {}),
      message: `failover chain exhausted: ${underlying.message}`,
      stopReason: underlying.stopReason,
      cause: underlying,
    };
  }

  function costForTarget(t) {
    const entry = ledger.get(t.name);
    if (!entry || entry.callCount === 0) return 0;
    const c = t.computeCostUsd(t.model, entry.usage);
    return Number.isFinite(c) ? c : 0;
  }

  return {
    serializeRequest({ shadowTranscript, input, previousResponseId }) {
      const first = targets[0];
      active = {
        target: first,
        stash: { shadowTranscript, input, previousResponseId },
        history: [],
        retriedSameTarget: false,
        lastCallStart: 0,
      };
      return buildRequestFor(first, active.stash);
    },

    async complete(req) {
      if (active === null) {
        throw new Error('failoverProvider.complete called before serializeRequest — wire the same composite as both ctx fields');
      }
      let currentReq = req;
      while (true) {
        const t = active.target;
        active.lastCallStart = now();
        let result;
        try {
          result = await t.complete(currentReq);
        } catch (thrown) {
          result = normalizeThrow(thrown);
        }
        const durationMs = now() - active.lastCallStart;

        if (!result || result.kind !== 'error') {
          attributeSuccess(t, result, durationMs);
          active = null;
          return result;
        }

        const action = resolveAction(policy, result, t, active.history);
        const reason = errorReasonString(result);

        if (action === 'fail-fast') {
          active = null;
          return result;
        }

        if (action === 'retry-same' && !active.retriedSameTarget) {
          const backoff = computeBackoffMs(result);
          if (backoff !== null) {
            active.retriedSameTarget = true;
            if (backoff > 0) await sleep(backoff);
            continue;
          }
        }

        active.history.push({ target: t.name, reason });
        const next = pickNextTarget(targets, active.history);
        if (!next) {
          active = null;
          return chainExhaustedError(result);
        }

        failoverCount += 1;
        emit(failoverDecision({
          from: t.name,
          to: next.name,
          reason,
          attempt: active.history.length + 1,
        }));
        active.target = next;
        active.retriedSameTarget = false;
        currentReq = buildRequestFor(next, active.stash);
      }
    },

    // The kernel ctx calls this with `(model, totalUsage)` once at session
    // end. Both args are intentionally ignored: the per-target ledger
    // holds USAGE (integer tokens) and the answer is each target's own
    // cost fn applied once to its accumulated usage, then summed across
    // targets. Two floats for a 2-target session — not N-per-turn — so
    // the sum is deterministic, and a single-target chain matches the
    // baseline byte-for-byte. The kernel-side evolution to a zero-arg
    // form is a later, separate consideration; keep the current
    // signature for ctx-shape compatibility.
    computeTotalCostUsd(_model, _usage) {
      let total = 0;
      for (const t of targets) total += costForTarget(t);
      return total;
    },

    summary() {
      const per_target = targets.map((t) => {
        const entry = ledger.get(t.name);
        return {
          name: t.name,
          provider: t.provider,
          model: t.model,
          calls: entry?.callCount ?? 0,
          usage: entry?.usage ?? {},
          cost_usd: costForTarget(t),
          total_latency_ms: entry?.totalLatencyMs ?? 0,
        };
      });
      const total_cost_usd = per_target.reduce((acc, p) => acc + p.cost_usd, 0);
      metrics(failoverSummary({ per_target, total_cost_usd, failover_count: failoverCount }));
    },
  };
}

export { defaultClassify };
