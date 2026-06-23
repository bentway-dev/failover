// CustomEvent factories for the failover library. Each one wraps
// `@bentway/core/events`'s `customEvent({ subtype, ...fields })`, which
// renders to `{ type: 'system', subtype, ...fields }` in the
// stream-json sink. First real external use of the 0.3.0 passthrough.

import { customEvent } from '@bentway/core/events';

/**
 * Emitted when the composite switches from one target to another in
 * response to an error. `attempt` counts from 1 for the FIRST call of
 * the loop turn (so a clean call has attempt:1; a failover-from-first
 * to-second emits attempt:2 as it begins).
 *
 * @param {{ from: string, to: string, reason: string, attempt: number }} args
 */
export const failoverDecision = ({ from, to, reason, attempt }) =>
  customEvent({ subtype: 'failover_decision', from, to, reason, attempt });

/**
 * Emitted once per SUCCESSFUL call to a target. The composite carries
 * the per-target ledger; this event surfaces the per-call delta so a
 * host can plot cost/latency per route without consulting the ledger.
 *
 * @param {{ target: string, model: string, usage: object, cost_usd: number, latency_ms: number }} args
 */
export const routeUsage = ({ target, model, usage, cost_usd, latency_ms }) =>
  customEvent({ subtype: 'route_usage', target, model, usage, cost_usd, latency_ms });

/**
 * Emitted when the transcript trim dropped one or more
 * provider-shaped blocks before re-serializing for a new target.
 * `dropped` is a deduped list of strings naming what was trimmed:
 *   - `reasoning:<sourceProvider>` for stripped reasoning blocks
 *   - `phase` for the dropped text-block phase field
 *
 * @param {{ target: string, dropped: string[] }} args
 */
export const failoverDegradation = ({ target, dropped }) =>
  customEvent({ subtype: 'failover_degradation', target, dropped });

/**
 * Optional teardown summary. The composite carries the ledger
 * regardless; the host MAY call `composite.summary()` at session end
 * to emit this aggregate. Useful for dashboards that consume one
 * stream line per session.
 *
 * @param {{ per_target: object[], total_cost_usd: number, failover_count: number }} args
 */
export const failoverSummary = ({ per_target, total_cost_usd, failover_count }) =>
  customEvent({ subtype: 'failover_summary', per_target, total_cost_usd, failover_count });
