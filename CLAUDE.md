# AgentArena AI — guide for coding agents

Multi-agent coding benchmark, objective evaluation, and evidence-based routing on top of HarnessRouter. Read `docs/PROGRESS.md` first to resume work.

## Commands

- `npm run db:up` starts Postgres (127.0.0.1:5433). `npx prisma migrate deploy` applies migrations. `npm run db:seed` loads demo history.
- `npm run dev` serves http://127.0.0.1:3100. Loopback only, on purpose.
- `npm run typecheck`, `npm run lint`, `npm test` (unit), `npm run test:integration` (Docker + `agentarena_test` DB), `npm run test:e2e`, `npm run build`.
- `npm run eval:rerun` re-scores stored benchmarks (reproducibility check).
- `npm run demo:live` is the live HarnessRouter case. Free dry run by default; `--confirm-spend` is billable and needs the user's explicit authorization.
- Never run `prisma migrate reset` on the dev DB. Tests use the separate `agentarena_test` DB with `migrate deploy`.

## Layout

- `src/lib/harnessrouter/`: documented API client only. Every field must trace back to `docs/HARNESSROUTER_RESEARCH.md`. Never invent endpoints or fields.
- `src/lib/agents/`: `AgentAdapter` implementations (demo = deterministic UHP-shaped events; live = HarnessRouter).
- `src/lib/orchestrator/`: runs, state machine transitions (conditional `updateMany`), semaphores, timeouts.
- `src/lib/evaluation/`: static analysis, Docker sandbox, scoring, evidence. Generated code runs **only** in the sandbox.
- `src/lib/routing/`, `src/lib/analytics/`: rules-based routing and aggregates.
- `src/app/`: pages and `/api` route handlers. `src/components/`: UI.

## Rules

- Strict TS. Validate every external input with Zod. Server-only modules import `server-only`. Client components must not import `@/lib/env|db|runtime|api`.
- Never fabricate scores, costs or live results. Simulated data is labelled (`mode=DEMO`, `costSource=SIMULATED`, `SIMULATED_FIXTURE`).
- A missing metric is `null`, never 0.
- No billable HarnessRouter calls, deployments, pushes or commits without explicit user authorization.
- Update `docs/PROGRESS.md` and `docs/TEST_RESULTS.md` after meaningful changes.
