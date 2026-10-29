# Security model

## Deployment assumption

AgentArena is a **single-user, local-only** tool. It has **no authentication**. It is safe only while bound to loopback (`next dev/start -H 127.0.0.1`, enforced by the npm scripts). **Do not expose it on a network or deploy it publicly** without first adding authentication and per-user authorization (see the roadmap).

## Threat model

| Asset | Threat | Mitigation |
|---|---|---|
| `HR_API_KEY` | Leak to the browser, logs, DB or git | Read only on the server (`server-only` env module). Settings shows "configured / not configured", never the value. The browser DTO omits harness ids and provider ids. The key is passed to redaction for errors and persisted text. Bearer and key patterns are redacted. `.env` is git-ignored. Unit tests check that client components cannot import env/db/runtime modules. |
| Host machine | Executing untrusted generated code | Generated code **never runs in the web server process**. It runs only in a throw-away container: `--network none`, `--read-only` root FS, read-only bind mount, noexec tmpfs, `--user 65534:65534`, `--cap-drop ALL`, `no-new-privileges`, 256 MB memory with no swap, 0.5 CPU, 64 PIDs, and a wall-clock kill (`SANDBOX_TIMEOUT_MS`). Docker is invoked with `execFile` argv arrays, never a shell, and with no user-controlled strings in argv. TypeScript is transpiled on the host with `transpileModule`, a pure transform. Static analysis parses code and never evaluates it. |
| Score integrity | A malicious solution fakes a test pass | Expected values never enter the sandbox; only arguments do, and comparison happens on the host. Result frames carry a per-run random nonce, and the last framed line wins. Integration tests cover forged frames. |
| Local app | DNS rebinding and CSRF from a malicious website | Middleware rejects any `Host` that isn't loopback (HTTP 421) and any cross-origin mutating API request (403). Both are covered by E2E tests. |
| Outbound requests | SSRF | Outbound calls go only to the operator-configured `HR_BASE_URL`, which must be https (http only for loopback) and contain no credentials, query or fragment. Paths are built from validated ids and must stay on the base origin and prefix. `redirect: "error"`. Provider `download_url` values are never followed. No user-supplied URLs are fetched; there is no repository import from URLs. |
| DB / API | Malformed or oversized input | Zod on every body (256 KB limit). Identifiers, relative paths (no traversal), test specs (data only: arrays and JSON values) and limits are all bounded. Function names must be identifiers, so they cannot inject into runner code. |
| Artifacts | Stored-XSS through generated files | Shown as escaped text in `<pre>`. Downloads use `text/plain`, `Content-Disposition: attachment`, `nosniff` and `CSP: sandbox`. Size limit 200 KB; provider downloads limited to 512 KB. |
| Prompt injection | Instructions embedded in task files or agent output | Agent output is treated as data: it is stored, escaped and graded. Nothing in it is executed outside the sandbox or used as a command. |
| Spend | Accidental billable runs | DEMO is the default. LIVE requires `AGENTARENA_MODE=LIVE`, `ALLOW_LIVE_EXECUTION=true`, `HR_API_KEY` and a per-benchmark confirmation checkbox. `max_cost_usd` is forwarded but described as a hint, not a cap. Concurrency is capped (default 2). |
| Duplicate execution | Retries double-billing | Each run has a unique `Idempotency-Key` that is reused on retry. Retries happen only for 429/503/504/network errors and only **before** the provider accepted the task. After a stream drop, the adapter polls instead of resubmitting. |

## Residual risks (honest list)

1. **Container isolation is not a VM.** A kernel or Docker escape vulnerability would break isolation. For hostile workloads, use gVisor (`--runtime=runsc`) or a microVM; this is not configured here.
2. **The Docker daemon is privileged.** The server can start containers, so anyone who controls the server process controls Docker. This is acceptable only for local, single-user use.
3. **Static checks are heuristics.** Python checks are regex-based. Passing them is **not** evidence of security.
4. **No authentication or authorization.** Do not expose the app on a network.
5. **Live provider behaviour is unverified.** The adapter matches the documented contract but has never run against a real account.
6. **Dependency advisories** (`npm audit`, 2026-10-29, after upgrading to zod 4 and vitest 4):
   - `next` → bundled `postcss` (<8.5.10, high). This is CSS processing at build time on this project's own stylesheets, so no attacker-controlled CSS is processed. The fix requires Next 16 (major).
   - `prisma` CLI → `@prisma/config` → `deepmerge-ts` (high). This is CLI/dev tooling and is not shipped in the runtime client. The fix requires Prisma 7 (major).
   - These are accepted until the major upgrades in the roadmap. The CI audit step is report-only for that reason.

## Security-focused tests

- Unit: `tests/unit/security.test.ts` covers redaction, SSRF guard, id validation, host and origin guard, and secret-exposure static checks. `tests/unit/domain.test.ts` covers path traversal, identifier validation and limit bounds. `tests/unit/harnessrouter.test.ts` covers key redaction in errors, the never-followed `download_url`, and refusal without a key.
- Integration: `tests/integration/sandbox.test.ts` covers that network is blocked, the work dir is read-only, infinite loops are killed, load errors are reported, and forged frames are ignored.
- E2E: cross-origin POST → 403, rebinding `Host` → 421, and Settings never renders a key.
