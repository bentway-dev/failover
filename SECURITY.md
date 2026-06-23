# Security Policy

## Reporting a vulnerability

Report security issues privately to [security@bentway.dev](mailto:security@bentway.dev).
Please do not open a public issue for undisclosed vulnerabilities.

## Supply chain

Releases from 0.1.1 onward are published from CI
via npm trusted publishing (OIDC) with Sigstore provenance attestations.
Verify a release with `npm audit signatures`.

## Threat model

A fuller mapping to the OWASP Top 10 for Agentic Applications and MCP
guidance is planned for a future release.
