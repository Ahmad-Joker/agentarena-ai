# Implementation plan

| Phase | Scope | Acceptance criteria | Status |
|---|---|---|---|
| 0 · Environment audit | Workspace, Node 24, npm 11, Docker 29 (daemon up), git, Python 3.13 | Plan written; blockers found | ✅ Found blocker D1 (long paths): moved to a short path |
| 0b · Research | HarnessRouter docs, CE repo, starter kit, plugin skill, UHP spec, OpenAPI | `HARNESSROUTER_RESEARCH.md` separates documented facts from assumptions | ✅ |
| 1 · Foundation | Next 15 App Router, strict TS, Tailwind 4, Prisma 6 + Postgres 16 (Docker Compose), env validation, Vitest, Playwright | Installs, compiles, renders | ✅ |
| 2 · Core UI | Dashboard, New benchmark, Live arena, Results, History, Leaderboard, Smart router, Settings | Full journey works in demo mode | ✅ (E2E) |
| 3 · HarnessRouter integration | Client, SSE parser, error normalization, discovery, upload, stream, poll-recovery, cancel, spend, files | Testable without credentials; live explicitly unverified | ✅ contract-tested · ⏳ live gate open |
| 4 · Benchmark engine | Orchestrator, state machine, semaphores, timeouts, retries, persistence, reconciliation | Integration and E2E tests pass | ✅ |
| 5 · Evaluation engine | Static analysis, Docker sandbox, declarative tests, scoring, evidence, security gate | Scores reproducible from saved evidence | ✅ (`npm run eval:rerun` → 0 changes) |
| 6 · Routing | Classifier, aggregation, recommendation, insufficient-data handling | Deterministic tests pass | ✅ |
| 7 · Hardening | Validation, secret exposure, SSRF, CSRF/rebinding, dependency audit, concurrency | No unresolved critical/high issues within scope | ✅ (remaining advisories need majors; documented) |
| 8 · Experience | Responsive layout, a11y labels, empty/loading/error states | — | ✅ baseline |
| 9 · Verification | typecheck, lint, unit, integration, E2E, build, audit | All pass | ✅ see TEST_RESULTS.md |
