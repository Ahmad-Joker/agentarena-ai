# Test results

Final verification run: **2026-10-29**, on Windows 11, Node 24.14.0, Docker 29.6.2 (Desktop), Postgres 16-alpine and the node:22-alpine / python:3.12-alpine sandbox images. Every command below was actually executed. The results are copied from its output.

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ exit 0 |
| Lint | `npm run lint` | ✅ exit 0, no warnings |
| Unit + contract tests | `npm test` | ✅ **79 / 79 passed** (5 files) |
| Integration tests | `npm run test:integration` | ✅ **18 / 18 passed**: 7 Docker sandbox, 11 orchestrator on Postgres |
| End-to-end | `npm run test:e2e` | ✅ **8 / 8 passed** (Chromium, cold dev server) |
| Production build | `npm run build` | ✅ compiled successfully |
| Reproducibility | `npm run eval:rerun` (run twice) | ✅ 2nd pass: "Re-evaluated 17 benchmarks; **0** run total(s) changed" |
| Seed via real pipeline | `npm run db:seed` | ✅ 15 benchmarks, 45 runs (39 completed, 3 provider failures, 3 provider timeouts) |
| Dependency audit | `npm audit` | ⚠️ 0 critical, 4 high, 1 moderate remaining. All need Next 16 / Prisma 7 majors; see SECURITY.md |

## Coverage by area

- **Unit (`tests/unit`)**: state machine and benchmark status; input validation (path traversal, identifiers, limits); semaphore FIFO and abort; scoring (missing ≠ zero, coverage, normalization, relative efficiency); static analysis (TS AST rules, Python heuristics, syntax errors, missing export); evaluation engine (host-side grading, expected values never sent, failed/cancelled/unavailable/syntax/timeout paths, reproducibility, security gate); SSE parser (split chunks, CRLF, malformed frames); stream normalization (documented terminal events, cancellation via `response.failed`); HarnessRouter client contract (headers, body, version discovery, error envelope, key redaction, missing key, base-URL rules, CE prefix); live adapter (full flow, `download_url` never followed, extraction fallback, poll recovery without resubmission, cancel on abort, failure codes, unavailable cost); demo adapter (determinism, failure paths, stub for custom tasks, cancellation); prompt fairness; classifier; routing (insufficient evidence, scope fallback, confidence, security gate, cost without data, speed, language filter, cancelled runs ignored); stats; security (redaction, SSRF, host/origin guard, secret-exposure static checks).
- **Integration (`tests/integration`)**:
  - Sandbox: TS execution, network blocked, read-only work dir, infinite-loop kill, load errors, forged frames, and all 10 demo fixtures producing the expected pass counts.
  - Orchestrator: full benchmark persistence, double-start refusal, simulated provider failure → FAILED / provider timeout → TIMED_OUT, orchestrator timeout, cancellation of in-flight and queued runs, global concurrency cap, retry with the same idempotency key, restart reconciliation, no reconciliation of new benchmarks, invalid configs (unknown agent, live disabled, spend not confirmed, mode mismatch), task dedup.
- **E2E (`tests/e2e`)**: DEMO labelling, create → live arena → results with a real failure state and evidence, cancellation, invalid input message, smart router, history/leaderboard, CSRF 403 and rebinding 421, Settings never renders a key.

## Defects found by verification (all fixed, with regression tests)

1. Restart reconciliation cancelled freshly created benchmarks (race on first orchestrator use).
2. SSE parser failed when CRLF was split across chunks.
3. An `eval()`-based solution could rank first (security gate added).
4. A cancel that arrived after all runs had finished (during evaluation) relabelled a completed benchmark as CANCELLED.

## Not verified

- **Live HarnessRouter execution.** No credentials, and no billable calls were authorized. Contract tests use documented shapes, not recorded traffic.
- CI workflow (`.github/workflows/ci.yml`) is written but has not run on GitHub (nothing pushed).
- Responsiveness was checked at desktop widths. Mobile layouts were not tested by hand.
