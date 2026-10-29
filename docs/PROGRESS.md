# Progress log

_Last updated: 2026-10-29_

## Current state

The MVP is complete in **demo mode**. Every Definition-of-Done item is met except the separate **live HarnessRouter gate** (needs credentials and authorization).

## Completed

- Research: documented facts vs assumptions (docs/HARNESSROUTER_RESEARCH.md).
- Prisma schema and initial migration (10 models, status enums, indexes). Local Postgres via Docker Compose.
- HarnessRouter client and live adapter, contract-tested (17 tests).
- Demo adapter with three simulated personalities covering completion, partial correctness, provider failure, provider timeout, risky code and cancellation.
- Orchestrator with state machine, concurrency limits, timeouts, retries with idempotency keys, cancellation, and restart reconciliation.
- Evaluation engine: TypeScript AST and Python heuristic static analysis, Docker sandbox with network off, host-side grading, weighted scoring with coverage, security ranking gate, reproducible evidence.
- Routing engine: classifier, aggregation, minimum evidence, scope fallback, confidence, security gate.
- UI: 7 pages, live arena, results with evidence, charts.
- Tests: 79 unit, 18 integration, 8 E2E. Production build passes.
- Docs, CI workflow, README, screenshots.

- `npm run demo:live`: ready-made live HarnessRouter case (dry run by default, `--confirm-spend` to bill). Verified 2026-10-29: real `GET /v1/uhp` against Cloud, and the dry run against a local fake HarnessRouter (agent listing, bad-key error, live-switch guard). The billable path has not run: no key yet.

## Bugs found and fixed during verification

1. **Reconciliation race**: the restart-recovery sweep ran when the orchestrator was first used and cancelled the benchmark that had just been created. Fixed by only reconciling runs created before the orchestrator instance, and initializing it before creation. Regression test added.
2. **SSE CRLF split across chunks** broke frame parsing. Fixed by normalizing over the whole buffer. Covered by a unit test.
3. **`eval`-based solution could win** at 5% security weight. Added the security ranking gate (D10).
4. **Late cancel relabelled a finished benchmark** as CANCELLED (cancel arrived during evaluation). A benchmark is now CANCELLED only if a run actually was.
5. Dependency advisories: upgraded zod 3 → 4 (high) and vitest 3 → 4 (critical, dev).

## Pending / next recommended actions

1. **Live gate**: run the checklist in KNOWN_LIMITATIONS.md with a real key (needs the owner's authorization and budget).
2. Repository-level tasks (multi-file import, run the repo's own tests in the sandbox).
3. Move orchestration to a worker with a durable queue. Resume live runs by polling after a restart.
4. Upgrade Next 16 / Prisma 7 to clear the remaining advisories.
5. Push updates (SSE) to the browser. Trace ingestion from `/v1/traces`.
6. Authentication and multi-user workspaces before any non-local deployment.
