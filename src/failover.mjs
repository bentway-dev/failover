// failoverProvider — the composite that satisfies the kernel's
// {serializeRequest, complete, computeTotalCostUsd} ctx contract by
// driving N real Targets behind one chain + policy.
//
// The mechanism, in one paragraph: `serializeRequest` stashes its raw
// inputs and builds the request for the current target. `complete` runs
// the call. On success it accumulates per-target usage and emits a
// `route_usage` event. On a routed error it consults the policy, picks
// the next viable target, re-serializes the stashed transcript for that
// target, and re-calls `complete` internally — repeating until success,
// fail-fast, or chain exhaustion. The kernel sees ONE logical call per
// turn; transcript portability is automatic because every internal
// re-call re-serializes the full neutral transcript via the new
// target's adapter.
//
// `computeTotalCostUsd` ignores the kernel's per-session model arg and
// sums each target's own cost fn against its own accumulated usage —
// the only cost number that means anything under mixed-target sessions.

import { accumulateUsage } from '@bentway/core/usage';
import { trimForTarget } from './trim.mjs';
import {
  defaultClassify,
  resolveAction,
  computeBackoffMs,
  pickNextTarget,
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

/**
 * @param {Target[]} targets
 * @param {((error: NeutralError, target: Target, history: object[]) => (Action | null | undefined)) | undefined} policy
 * @param {{ emit: EmitFn, now?: () => number, sleep?: (ms: number) => Promise<void> }} hooks
 * @returns {{
 *   serializeRequest: (args: { shadowTranscript: object, input: unknown, previousResponseId?: string }) => object,
 *   complete: (req: object) => Promise<PortResult | NeutralError>,
 *   computeTotalCostUsd: (model: string, usage: Usage) => number,
 *   summary: () => void,
 * }}
 */
export function failoverProvider(targets, policy, hooks) {
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
  if (!hooks || typeof hooks.emit !== 'function') {
    throw new TypeError('failoverProvider: `hooks.emit` must be the same sink the host wires into the loop');
  }

  const emit = hooks.emit;
  const now = typeof hooks.now === 'function' ? hooks.now : Date.now;
  const sleep = typeof hooks.sleep === 'function'
    ? hooks.sleep
    : (ms) => new Promise((r) => setTimeout(r, ms));

  /** @type {Map<string, { usage: Usage, callCount: number, totalLatencyMs: number, costUsd: number }>} */
  const ledger = new Map();
  for (const t of targets) {
    ledger.set(t.name, { usage: {}, callCount: 0, totalLatencyMs: 0, costUsd: 0 });
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
    const turnCost = target.computeCostUsd(target.model, turnUsage);
    entry.costUsd += Number.isFinite(turnCost) ? turnCost : 0;
    emit(routeUsage({
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
        const result = await t.complete(currentReq);
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
          return result;
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

    computeTotalCostUsd(_model, _usage) {
      let total = 0;
      for (const t of targets) {
        const entry = ledger.get(t.name);
        if (!entry) continue;
        total += entry.costUsd;
      }
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
          cost_usd: entry?.costUsd ?? 0,
          total_latency_ms: entry?.totalLatencyMs ?? 0,
        };
      });
      const total_cost_usd = per_target.reduce((acc, p) => acc + p.cost_usd, 0);
      emit(failoverSummary({ per_target, total_cost_usd, failover_count: failoverCount }));
    },
  };
}

export { defaultClassify };
