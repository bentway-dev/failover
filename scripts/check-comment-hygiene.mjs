#!/usr/bin/env node
// Refuse internal-process leakage in source, tests, docs, and CI config.
//
// Scans every relevant file in the repo for the forbidden patterns and
// exits non-zero if any match. Intended to run as a workspace-wide gate
// (`pnpm test:hygiene`) alongside the per-package file-size + api-
// extractor checks.
//
// The patterns split into two strata:
//
//   GENERIC (committed, below) — regex CLASSES that catch forbidden
//     token SHAPES without naming any specific value. Safe to commit
//     because they don't themselves reveal an org-specific string.
//
//   LOCAL  (`.hygiene-local.mjs`, gitignored) — the specific
//     org-coupled strings (project names, internal refactor labels,
//     cross-repo paths, etc.) the generic patterns can't classify.
//     Committing these values would itself be the leak this gate is
//     meant to prevent; instead they live in a local supplement file
//     that is gitignored and shipped via secure channels (CI secret,
//     onboarding doc, password manager).
//
// `.hygiene-local.example.mjs` (committed) shows the structure of the
// local supplement with placeholder values, so new contributors and CI
// know what to author.
//
// There is NO per-line allow-marker. Two exemption layers exist and both
// require an explicit, reviewable change:
//
//   1. Pattern-level — refine the regex (e.g. the YYYY-MM-DD lookahead
//      that lets API-version strings pass while catching orphaned
//      YYYY-MM process dates).
//   2. File-level — add the file to the EXEMPT set below.
//
// CI behavior when the local supplement is absent:
//
//   - HYGIENE_REQUIRE_LOCAL=1  → hard-fail with exit code 2 (trusted-push
//     mode; a missing supplement means the pipeline is misconfigured).
//   - HYGIENE_REQUIRE_LOCAL unset → warn and run generic-only (fork-PR
//     mode; the secret is unavailable to PRs from forks by design, so the
//     gate degrades cleanly rather than blocking external contributions).
//
// See AGENTS.md § House style for the prose contract this enforces.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_SUPPLEMENT_PATH = resolve(REPO_ROOT, '.hygiene-local.mjs');
const EXAMPLE_SUPPLEMENT_PATH = '.hygiene-local.example.mjs';

// Scan roots. Directories are walked; bare files are scanned as-is.
const TARGETS = [
  'packages',
  'test',
  '.github',
  'README.md',
  'CHANGELOG.md',
  'SECURITY.md',
];

// Directories that never contain authored content.
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'temp', '.git', '__snapshots__']);

// File extensions to scan when walking directories. Bare files in
// SCAN_BARE_FILES are scanned regardless of extension.
const EXTENSIONS = new Set(['.mjs', '.ts', '.md', '.yml', '.yaml', '.json', '.sh']);
const SCAN_BARE_FILES = new Set([
  'README.md',
  'CHANGELOG.md',
  'SECURITY.md',
]);

// Files exempt from the scan: they describe or define the rules and so
// must reference the forbidden token shapes by example. The local
// supplement and its template are exempt because they ARE the rules for
// the org-specific tokens.
const EXEMPT = new Set([
  'scripts/check-comment-hygiene.mjs',
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'STYLE.md',
  '.hygiene-local.mjs',
  '.hygiene-local.example.mjs',
]);

// ── Generic forbidden patterns ─────────────────────────────────────────
//
// These catch forbidden token SHAPES without naming any specific value.
// Safe to commit publicly.

const GENERIC_FORBIDDEN = [
  // Note: ticket-id prefixes are inherently org-specific (the prefix
  // names the tracker). A truly generic `LETTERS-NUMBERS` regex would
  // false-positive on legitimate public references like SHA-256, UTF-16,
  // ISO-9001, GPT-5, RFC-2119, etc. Specific prefixes belong in the
  // local supplement, not the generic layer.

  // Phase/plan refs in any common syntactic shape.
  { rx: /\bPhase \d/, label: '"Phase N" planning artifact' },
  { rx: /\bplan §/, label: '"plan §" planning artifact' },
  { rx: /\([0-9]+[a-g]\.[a-z0-9.]+\)/, label: 'phase number in parens' },
  { rx: /\bin [0-9]+[a-g]\.[a-z0-9.]/, label: 'phase-section reference' },

  // Orphaned YYYY-MM dates. Negative lookahead lets full YYYY-MM-DD
  // strings (e.g. an API version) pass.
  { rx: /\b20\d\d-[01]\d\b(?!-)/, label: 'orphaned YYYY-MM date (process artifact)' },

  // Generic extraction-history phrases — phrases that almost always
  // signal commit/PR text bleeding into source comments.
  { rx: /\b(?:extracted|ported|relocated|migrated)\s+(?:verbatim\s+)?(?:from|to|in)\s+20\d\d/i, label: 'extraction-history phrase' },
  { rx: /\boriginally\s+(?:from|in|at|relocated|extracted)\b/i, label: 'extraction-history phrase' },
];

// ── Local supplement loader ────────────────────────────────────────────

async function loadLocalSupplement() {
  try {
    statSync(LOCAL_SUPPLEMENT_PATH);
  } catch {
    return null; // file absent — caller decides whether to fail
  }
  try {
    const mod = await import(pathToFileURL(LOCAL_SUPPLEMENT_PATH).href);
    const entries = Array.isArray(mod.default) ? mod.default : [];
    // Validate shape — bad entries should fail loud, not silently pass.
    for (const entry of entries) {
      if (!(entry?.rx instanceof RegExp) || typeof entry?.label !== 'string') {
        throw new Error(`bad entry in .hygiene-local.mjs: ${JSON.stringify(entry)}`);
      }
    }
    return entries;
  } catch (err) {
    console.error(`check-comment-hygiene: failed to load .hygiene-local.mjs: ${err.message}`);
    process.exit(2);
  }
}

const localForbidden = await loadLocalSupplement();

if (localForbidden === null) {
  if (process.env.HYGIENE_REQUIRE_LOCAL === '1') {
    console.error('check-comment-hygiene: .hygiene-local.mjs missing under HYGIENE_REQUIRE_LOCAL=1.');
    console.error(`  Materialize it from the HYGIENE_LOCAL_RULES secret or copy ${EXAMPLE_SUPPLEMENT_PATH}.`);
    process.exit(2);
  }
  console.error('check-comment-hygiene: .hygiene-local.mjs missing — running generic patterns only.');
  console.error(`  Copy ${EXAMPLE_SUPPLEMENT_PATH} → .hygiene-local.mjs and fill in your org's tokens locally.`);
  console.error('  Trusted CI runs should set HYGIENE_REQUIRE_LOCAL=1 to hard-fail when the supplement is absent.');
}

const FORBIDDEN = [...GENERIC_FORBIDDEN, ...(localForbidden ?? [])];

// ── Scan ───────────────────────────────────────────────────────────────

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot) : '';
      if (EXTENSIONS.has(ext) || SCAN_BARE_FILES.has(entry.name)) yield path;
    }
  }
}

function* collectFiles() {
  for (const target of TARGETS) {
    const abs = join(REPO_ROOT, target);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) yield* walk(abs);
    else if (st.isFile()) yield abs;
  }
}

let violations = 0;
for (const file of collectFiles()) {
  const rel = relative(REPO_ROOT, file);
  if (EXEMPT.has(rel)) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { rx, label } of FORBIDDEN) {
      if (rx.test(line)) {
        console.error(`${rel}:${i + 1}: ${label}`);
        console.error(`  ${line.trim()}`);
        violations++;
        break; // one violation per line is enough
      }
    }
  }
}

if (violations > 0) {
  console.error('');
  console.error(`check-comment-hygiene: ${violations} violation(s). See AGENTS.md § House style.`);
  console.error('Rephrase the line. There is no per-line exemption.');
  process.exit(1);
}
console.log(`check-comment-hygiene: clean (${GENERIC_FORBIDDEN.length} generic + ${localForbidden?.length ?? 0} local patterns).`);
