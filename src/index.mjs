// Runtime-agnostic failover library for bentway. Composite provider
// over the published `@bentway/*` adapters that fails over mid-
// conversation by re-serializing the neutral transcript per target.
//
// This is the pre-release skeleton. The composite provider and target
// constructor land in 0.1.0; until then, this module exports only the
// version string so api-extractor has a stable baseline.

/**
 * Library version. The failover surface (`failoverProvider`, `target`)
 * lands in 0.1.0; this constant is the only export until then.
 *
 * @type {string}
 */
export const VERSION = '0.0.0-dev';
