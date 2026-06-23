# Contributing to failover

This file is the contract every contributor — human or LLM-driven — agrees
to when authoring changes here. It is intentionally short. Read it once
before your first change; re-read § House style if a gate rejects a diff.

The same file is loaded by Claude Code, Codex, Cursor, and similar
agents via the `AGENTS.md` convention. `CLAUDE.md` is a one-line
compatibility shim that points here.

---

## What this repo is

`@bentway/failover` is the runtime-agnostic failover library for the
bentway ecosystem — a composite provider over the published
`@bentway/*` adapters that fails over mid-conversation by re-serializing
the neutral transcript per target. v1 surface: ordered chains,
failure-class-aware routing, transcript-portable failover, golden-tested
per-route metrics.

This repo consumes published `@bentway/* ^0.3.0` from the npm registry —
no monorepo crossover. It is the external-consumer dogfood of the
kernel. Treat every change as something that will appear on a stranger's
`git log` with no prior context.

## Layered enforcement

Three kinds of checks run on every change. Each fails the build on
violation; none can be skipped.

1. **Per-package gates** (`pnpm test`)
   - `check-file-sizes.sh` — every source file under the per-package
     line cap (500 LOC default; allowlist large modules explicitly).
   - `check-api-report.sh` — `@microsoft/api-extractor` diffs the live
     extraction of the package's public API against the committed
     `etc/*.api.md` snapshot. Drift = FAIL.

2. **Workspace gates** (`pnpm test`)
   - `test:hygiene` — `scripts/check-comment-hygiene.mjs`. Refuses the
     internal-process leakage patterns listed below.
   - `test:unit` — vitest specs (when present).
   - `lint:pkg` — `publint && attw --pack`. Catches `exports`-map and
     types-resolution regressions.

3. **CI** runs the same set on every push and pull request
   (`.github/workflows/ci.yml`). Do not push without `pnpm test` green
   locally first.

Reproduce a CI failure locally with the exact same invocation:
`pnpm test`. There is no CI-only step.

---

## House style

These rules are what the hygiene gate enforces. Read them before writing
or modifying comments anywhere in the repo.

### No internal-process leakage

The hygiene gate rejects any line containing tokens from these classes:

- **Phase / plan refs** — `Phase N`, `plan §`, `(Nx.y.z)`-style phase
  numbers, "in Nx.y" section references
- **Orphaned year-month dates** — `YYYY-MM` without a trailing `-DD`
  (full `YYYY-MM-DD` strings such as an API version pass; the regex
  uses a negative lookahead)
- **Extraction-history phrases** — "originally from", "ported from
  YYYY", "relocated from YYYY", and similar phrases that betray
  copy-paste from another codebase
- **Org-specific tokens** — internal ticket-id prefixes, project /
  product / refactor / skill names, sibling-repo paths. Their concrete
  values live in `.hygiene-local.mjs` (gitignored — see below). The
  committed gate file deliberately does NOT name these.

These are non-negotiable.

#### How the rule set is split

The gate's pattern list lives in two strata:

| stratum | where | what | committed? |
|---|---|---|---|
| **Generic patterns** | `scripts/check-comment-hygiene.mjs` | regex *classes* that catch forbidden token *shapes* without naming any specific value | yes |
| **Local supplement** | `.hygiene-local.mjs` | the specific org-coupled strings the generic patterns cannot classify | **no — gitignored** |
| **Template** | `.hygiene-local.example.mjs` | placeholder structure showing how to author the local file | yes, no org data |

The local supplement is gitignored on purpose. Committing the strings
this gate forbids would itself be the leak the gate is meant to prevent.

To set up `.hygiene-local.mjs` for the first time:

```bash
cp .hygiene-local.example.mjs .hygiene-local.mjs
# fill in your org's tokens; values come from your onboarding doc /
# secrets vault, NOT from any committed file.
```

CI receives the file via the `HYGIENE_LOCAL_RULES` repository secret
(see `.github/workflows/ci.yml`). Trusted pushes set
`HYGIENE_REQUIRE_LOCAL=1` so a missing supplement hard-fails. PR runs
from forks — which cannot see repository secrets by design — degrade
to generic-only patterns so external contributions aren't blocked by
infrastructure they can't reach.

#### No per-line exemption

There is no allow-marker. If your line matches a forbidden pattern,
**rephrase it**. Two exemption layers exist; both require an explicit
change to the contract:

1. **Pattern-level** — refine the regex (e.g. the `YYYY-MM-DD` lookahead
   that lets API-version strings pass while catching orphaned `YYYY-MM`
   process dates).
2. **File-level** — add the file to the `EXEMPT` set in
   `scripts/check-comment-hygiene.mjs`.

Both layers are visible in code review. The hygiene contract is meant
to drift slowly and deliberately, not via per-line workarounds in
unrelated source files.

### Comments and docs

Default to writing **no** comments. Add one only when:

- the *why* is non-obvious (a workaround, an invariant, a constraint a
  reader cannot infer from the surrounding code)
- the behavior is surprising or violates a reasonable expectation
- the contract is load-bearing and not captured by the name + types

Do not add:

- *what* comments — the code already says what it does
- planning, history, or commit-message text in source
- references to prior call sites or to internal documents
- decorative dividers or section banners in short modules

### Module headers

Two to four lines describing what the module exports and what it is
used for. Optionally a one-line note about dependencies (e.g. "Imports
nothing host-specific"). That is the whole header.

### JSDoc

Every exported function gets a JSDoc block with at least `@param` /
`@returns` types. The types feed into the `tsc`-emitted `.d.mts`, which
feeds into api-extractor, which is the **public-API contract**. A weak
JSDoc surfaces as `any` in the committed `.api.md` reports.

Keep prose in the JSDoc short. One paragraph max, plus the parameter
list. Long behavioral notes belong in a single inline comment at the
relevant code site, not in the doc block.

### Test files

Test file headers describe what is under test in one to three lines.
Same hygiene as source — no phase numbers, tickets, or planning history.

---

## Public-API contract

The `etc/*.api.md` reports are the API every external consumer programs
against. Treat them as a checked-in contract:

- A change to a public symbol's signature **must** show up as a diff in
  the relevant `.api.md`.
- The api-extractor gate **fails the build** if the live extraction
  drifts from the committed report.
- The gate's purpose is to make every API change a conscious commit,
  not a silent side effect of an unrelated edit.

To intentionally change the public API:

1. Make the source change.
2. `pnpm run build` (regenerates `dist/*.d.mts`).
3. `pnpm dlx @microsoft/api-extractor run --local --config api-extractor.<sub>.json`
   regenerates `etc/<sub>.api.md` for each affected entry point.
4. Inspect the diff in `etc/*.api.md` — that diff IS the API change.
5. Commit the source change and the updated report together.

---

## Commands

```bash
pnpm install         # restore + prepare (runs tsc)
pnpm run build       # explicit rebuild
pnpm test            # all gates: file-size + api-report + hygiene + unit
pnpm run lint:pkg    # publint + attw --pack
```

The default contract: `pnpm test` is the single command a contributor
runs before pushing. If it passes locally, CI will pass.
