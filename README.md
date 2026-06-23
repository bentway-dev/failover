# failover

[![npm version](https://img.shields.io/npm/v/@bentway/failover.svg)](https://www.npmjs.com/package/@bentway/failover)
[![provenance](https://img.shields.io/npm/v/@bentway/failover?label=provenance&logo=sigstore)](https://www.npmjs.com/package/@bentway/failover)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/bentway-dev/failover/badge)](https://scorecard.dev/viewer/?uri=github.com/bentway-dev/failover)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

> Runtime-agnostic failover library for bentway.

A composite provider over the published `@bentway/*` adapters that fails over mid-conversation by re-serializing the neutral transcript per target. Ordered chains, failure-class routing, transcript-portable failover, golden-tested per-route metrics.

## Install

```bash
npm install @bentway/failover
```

## Quick start

<!-- PER-REPO: a minimal, copy-pasteable example showing the core use case. -->

```typescript
// example here
```

## Why failover

<!-- PER-REPO: 3–5 bullets covering what's distinctive. -->

- ...
- ...

## Contributing

See [AGENTS.md](AGENTS.md) for the contributor contract: house style, gate
model, and the rules every change must satisfy before `pnpm test` passes.
