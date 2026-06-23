# Changelog

Notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-23

### Added

First release. `@bentway/failover` is a runtime-agnostic failover
library for [bentway](https://github.com/bentway-dev/bentway): a
composite provider over the published `@bentway/*` adapters that fails
over mid-conversation by re-serializing the neutral transcript per
target.

The v1 quartet — the sharp core, not parity with general-purpose
gateways:

- **Ordered fallback chains** — declare N targets in priority order;
  the composite picks the first viable target each call.
- **Failure-class-aware routing** — built on the kernel's neutral
  `{kind:'error', stage, retryable, status?}` contract:
  - transport 429 → retry-same once with capped backoff, then failover
  - 529 / 5xx / no-status retryable → failover immediately
  - 4xx non-retryable (auth, bad header) → fail-fast, no failover
  - completion-stage errors → return unchanged for the host's
    bad-completion hook to redrive
- **Transcript-portable mid-loop failover** — the differentiator. On a
  routed error, the composite re-serializes the same neutral
  transcript for the next target via that target's own adapter. The
  kernel's loop sees one logical call per turn; the failover is
  transparent.
- **Golden-tested per-route metrics** — `route_usage`,
  `failover_decision`, `failover_degradation`, and an optional
  `failover_summary` travel as `customEvent` passthroughs (first real
  external use of the kernel's 0.3.0 passthrough). The composite's
  `computeTotalCostUsd` sums each target's own cost fn against its own
  accumulated usage — the only cost number that means anything under
  mixed-target sessions.

### Cross-provider fidelity — degradation is explicit, not lossless

When the next target's provider differs from the current one, the
library strips reasoning blocks whose `provider` tag doesn't match
the new target before re-serializing (cross-provider reasoning
payloads are provider-shaped verbatim — leaving them in produces wire
errors or silent corruption). The drop is reported via the
`failover_degradation` `customEvent`, so the host learns what was
lost. The library does NOT attempt to translate Anthropic signed
thinking into OpenAI encrypted reasoning — those envelopes are
semantically incompatible. Failover preserves the conversation; it
does not preserve every provider-specific artifact.

### OpenAI targets must be stateless

`createTarget` for an OpenAI target requires
`openaiStateless: true`, and the underlying `serializeRequest` must
have been built via
`makeOpenAiSerializeRequest({ stateless: true, ... })`. OpenAI's
stateful flow threads `previous_response_id` across turns; failing
over to a different provider would lose the chain. The assertion
fires at construction with a message naming the exact fix.

### Supply chain

This release is published via npm token (one-time bootstrap so the
package exists before its trusted publisher can be configured).
**Subsequent releases from 0.1.1 onward are published via npm OIDC
trusted publishing with Sigstore provenance.** Verify with
`npm audit signatures`.
