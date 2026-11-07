# ADR-0001: Scrapling is a parsing-only candidate sidecar

**Status:** Pilot accepted; production use not authorized  
**Date:** 2026-09-09

## Decision

LotSocial may send already-fetched, size-bounded HTML to an authenticated internal Scrapling 0.4.15 service only after the current TypeScript structured parser cannot produce an acceptable vehicle. The existing direct/Bright Data access layer remains unchanged and authoritative. Scrapling proposes candidates with field evidence; TypeScript performs the final VIN, page-type, challenge, image, and source-fidelity checks.

## Why this boundary

Bright Data solves access. Scrapling is being tested only for parsing recovery. Allowing the sidecar to fetch would duplicate access, reorder safeguards, add SSRF/DNS/redirect exposure, and make benchmark attribution ambiguous. The service therefore has no fetcher code, browser, cookies, customer credentials, or public ingress requirement.

## Failure behavior

The feature flag is off by default. Missing configuration, timeout, non-2xx response, oversized output, malformed JSON, schema drift, evidence failure, VIN conflict, or negative-page evidence returns control to the existing failure path. Nothing from the sidecar is persisted unless the TypeScript validator accepts it.

## Deferred

Browser/CDP use, public ingress, production deployment, paid hosting, and replacing or reordering Bright Data require a separate approval after the frozen 60-fixture gate passes.
