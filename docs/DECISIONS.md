# Technical decisions

| # | Decision | Why | Alternatives considered |
|---|---|---|---|
| D1 | Project lives in a short path (`Downloads\ai harness router`) | Windows long-path support is disabled on the dev machine. Next.js `node_modules` exceeded 260 chars in the original 180-char scratch path. | Enabling LongPathsEnabled (a system setting, so not changed) |
| D2 | Select the harness with `metadata.harness_id` on `POST /v1/responses` | The OpenAPI spec, the UHP spec and the official skill all agree. The one "Run a task" page that shows `/{harness_id}/v1/responses` is the outlier. | Path prefix |
| D3 | Discover `UHP-Version` from `GET /v1/uhp` | Sources quote three different versions | Hard-code a version |
| D4 | Demo adapter emits **UHP-shaped raw events** through the live normalizer | The demo exercises the same parsing, orchestration and persistence path as live | A separate fake UI state machine |
| D5 | Simulated agents return **fixed solutions** that are **actually evaluated** | The numbers on screen (tests passed, findings) are real measurements of real code. Only agent behaviour, timing and cost are simulated. | Fabricated scores (rejected: violates "never fabricate benchmark scores") |
| D6 | Declarative tests (`args`/`expected` JSON) instead of user test code | Test specs are data and cannot inject code into runners. Expected values stay on the host, so a solution cannot forge a pass. | Arbitrary test files (more flexible, much larger attack surface) |
| D7 | Docker containers as the sandbox | Available locally and in CI. Strong enough with network off, read-only FS, non-root user, dropped capabilities and limits. | gVisor or microVM (stronger, not available by default on Windows); `vm`/`isolated-vm` in-process (rejected: not a security boundary) |
| D8 | Missing metrics are excluded and weights renormalized; **coverage** is reported | "A missing metric must not be treated as a measured zero" | Treating as 0 (rejected), imputation (misleading) |
| D9 | Failed or timed-out runs score correctness = 0 and reliability = 0 | Not delivering a solution is a measured outcome, not missing evidence | Treating as unmeasured (would reward failing) |
| D10 | **Security ranking gate**: a high-severity security finding (eval, `new Function`, child_process, vm…) ranks the run below every clean run, in both benchmark ranking and routing | At 5% weight, an `eval`-based solution could otherwise win. Found during testing. A gate is transparent and does not distort the numeric score. | Raising the security weight (changes the user-facing default), score caps (arbitrary) |
| D11 | Efficiency is relative to peers and needs ≥ 2 completed measurements | An absolute duration score has no meaning across tasks | Fixed time budgets |
| D12 | Rules-based routing with minimum evidence (3 scored runs per agent, ≥ 2 agents), scope fallback and Wilson intervals | Interpretable, with no fabricated training data. The prompt forbids inventing ML. | Logistic regression (deferred until real data exists) |
| D13 | Polling (1 s) instead of SSE from server to browser | Robust across dev reloads and simple. Events are persisted, so polling is lossless. | SSE / WebSocket push (roadmap) |
| D14 | Orchestration runs in the Next.js server process; state lives in Postgres; orphan reconciliation on start (only runs created before the orchestrator instance) | Simple for a local MVP. Reconciliation found and fixed a real race (see TEST_RESULTS). | A separate worker and queue (roadmap) |
| D15 | Prisma 6, Next 15, zod 4, vitest 4 | Prisma 6 and Next 15 are stable and well known. zod and vitest were upgraded to clear high/critical advisories. | Prisma 7 / Next 16 (majors, deferred) |
| D16 | Hand-built shadcn-style primitives (cva + Radix Slot + tailwind-merge) instead of the shadcn CLI | Avoids an interactive generator; same patterns and API shape | `npx shadcn init` |
| D17 | Integration tests use a dedicated `agentarena_test` DB with `prisma migrate deploy`; tables are cleared only there | `prisma migrate reset` is (correctly) blocked for AI agents, and destructive resets are unnecessary | `migrate reset` |
| D18 | Apache-2.0 license recommended | Matches HarnessRouter Community Edition. Patent grant. Portfolio-friendly. | MIT |
