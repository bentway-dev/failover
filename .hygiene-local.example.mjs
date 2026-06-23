// Template for `.hygiene-local.mjs`.
//
// Copy this file to `.hygiene-local.mjs` (gitignored) and fill in the
// project-specific tokens the generic patterns in
// `scripts/check-comment-hygiene.mjs` can't classify by shape alone —
// internal project names, internal refactor labels, cross-repo paths,
// and any other org-coupled strings.
//
// The values you put here ARE the leak this gate is meant to prevent,
// which is why they live in a gitignored file rather than the committed
// script. Share the real `.hygiene-local.mjs` via secure channels (a CI
// secret, the onboarding doc, a password manager) — never via git.
//
// CI: the pipeline materializes this file from the `HYGIENE_LOCAL_RULES`
// repository secret (see `.github/workflows/ci.yml`). Trusted pushes set
// `HYGIENE_REQUIRE_LOCAL=1` so a missing supplement hard-fails; PR runs
// from forks (where the secret is unavailable by design) degrade to
// generic-only patterns rather than blocking external contributions.
//
// Schema: an array of `{ rx: RegExp, label: string }` objects. The label
// is shown to the contributor when the gate rejects their line.

export default [
  // { rx: /\b<your-project-name>\b/i, label: 'internal project name' },
  // { rx: /\b<your-internal-product>\b/, label: 'internal product name' },
  // { rx: /\b<refactor-or-skill-label>\b/, label: 'internal refactor / skill name' },
  // { rx: /\b<phrase-that-betrays-extraction-history>\b/, label: 'extraction-history phrase' },
  // { rx: /\b<sibling-repo>\/<known-dir>\//, label: 'cross-repo path reference' },
];
