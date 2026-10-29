# HarnessRouter research notes

Researched on **2026-10-29** from the public sources below. All facts here come from public docs; no authenticated API call has been made. Each item is labelled:

- **[DOC]**: stated in official documentation. Source in brackets.
- **[SPEC]**: from the published OpenAPI spec at `https://api.harnessrouter.ai/v1/openapi.json` (read 2026-10-29; not vendored in this repo).
- **[ASSUMPTION]**: inferred. Not confirmed.
- **[UNVERIFIED]**: implemented against the docs, but not yet tested against a live account.

## Sources

| Source | Used for |
|---|---|
| https://harnessrouter.ai/docs (and its sub-pages: authentication, base-url, run-a-task, streaming-events, harnesses-api, models, upload-files, sessions-and-files, session-and-response, cancel-a-session, errors-and-idempotency, arena, llm-resources) | Main reference |
| https://github.com/HarnessRouter/harnessrouter | Community Edition (CE), UHP, self-hosting |
| https://github.com/HarnessRouter/starter-kit | Integration patterns, licensing |
| https://github.com/HarnessRouter/plugins → `plugins/harnessrouter/skills/harnessrouter/SKILL.md`, `references/api-reference.md`, `references/runtime-integration.md` | The official integration skill (inspected, not installed) |
| https://unifiedharnessprotocol.org/spec/tasks | UHP response object |
| `https://api.harnessrouter.ai/v1/openapi.json` (not vendored) | Endpoint list and request schemas (response bodies are untyped in the spec) |

## What HarnessRouter is

- **[DOC]** It exposes coding-agent "harnesses" (Codex, Claude Code, Hermes, OpenCode, Gemini CLI, Aider, OpenHands and others; the CE README lists 30 bases) behind one API. It implements the **Unified Harness Protocol (UHP)**, whose task surface is **OpenAI Responses-compatible**.
- **[DOC]** A **configured agent** (also called a harness) combines a base harness, a default model, a system prompt, tools/MCP servers, skills and budgets. You select one by its id.
- **[DOC]** It ships a built-in **Arena**: up to 10 harness/model columns per prompt, compared on time and cost. `/v1/arenas` only stores the grouping; each column is an ordinary task. AgentArena AI adds what that Arena does not provide: **objective test execution, static analysis, explainable scoring, history-based routing**.

## Authentication and base URL

- **[DOC]** `Authorization: Bearer $HR_API_KEY`, using a Workspace API key. "The browser should never call HarnessRouter directly with the Workspace API key."
- **[DOC]** The Cloud base URL is `https://api.harnessrouter.ai`.
- **[DOC]** The CE base URL defaults to `http://localhost:3000/api/harness`. The CE API key is created in the CE console under **API Keys**.
- **[DOC]** Every request sends a `UHP-Version` header. `GET /v1/uhp` needs no key and returns `versions` and `default_version`; the skill also mentions `version_to_send`. An unsupported version returns `400 unsupported_protocol_version`.
- **[DOC]** Versions differ across sources: the skill observed `2026-09-28`, the uhp.org Tasks chapter shows `2026-10-19`, and the CE README references the spec folder `2026-09-12`. AgentArena therefore discovers the version at runtime and never hard-codes it.
- **[ASSUMPTION]** The key format and prefix are not documented. AgentArena makes no assumptions about them.

## Harness vs model selection

- **[DOC]** The harness is chosen with `metadata.harness_id` in `POST /v1/responses`. The skill says it is required on every request. Without it, the UHP falls back to a default harness. An unknown id returns `404 harness_not_found`. A mismatch with `previous_response_id` returns `409 harness_mismatch`.
- **[DOC conflict]** The "Run a task" page shows the path `/{harness_id}/v1/responses`, while the UHP spec, the official skill and the OpenAPI spec all use `POST /v1/responses` with `metadata.harness_id`. **AgentArena follows the majority: the OpenAPI spec, the UHP spec and the skill.**
- **[SPEC]** `CreateResponseBody` has these fields: `model`, `input`, `stream`, `previous_response_id`, `store`, `instructions`, `max_output_tokens`, `background`, `metadata`, `tools`, `include`, `backend`, `max_step`, `timeout_seconds`, `max_cost_usd`, `reasoning`.
- **[DOC]** `GET /v1/models` returns a catalog keyed by backend. `GET /v1/harnesses/{id}/models` returns the models a harness may use.
- **[ASSUMPTION]** A request-level `model` overrides the harness default. AgentArena only sends `model` when the user sets an override.

## Discovery

- **[DOC]** `GET /v1/harnesses` returns `{ "harnesses": [...] }`. Each item has `id`, `name` and `base`. **Response objects use camelCase** (for example `defaultModel`), while request bodies use snake_case.
- **[DOC]** `GET /v1/bases` lists base harnesses and runtime defaults (400 steps, 7200 s, 10 USD).

## Task execution and streaming

- **[DOC]** SSE frames are **data-only** (no `event:` lines). The event name is the JSON `type`, and every frame has a `sequence_number`.
- **[DOC]** Events: `response.created` (save `response.id` and `response.metadata.session_id`), `response.in_progress`, `response.output_item.added`, `response.output_text.delta`, `response.output_text.done`, `response.function_call_arguments.*`, `response.output_item.done`, `response.content_part.*`, `response.output_text.annotation.added`.
- **[DOC]** Terminal events:
  - `response.completed`
  - `response.incomplete`, with `incomplete_details.reason` of `max_steps` or `timeout`
  - `response.failed`, where `response.status === "cancelled"` means the task was cancelled
- **[DOC]** The answer is the `output_text` of the **last** `message` item in the terminal response.
- **[DOC]** Response statuses are `in_progress`, `completed`, `incomplete`, `failed` and `cancelled`. A session poll reports `done`, not `completed`.
- **[DOC]** If the stream drops, poll `GET /v1/responses/{id}` every 2–5 s. **Never resend the task.**
- **[DOC]** `usage` holds `input_tokens`, `output_tokens`, `total_tokens` and `cache_read_tokens`. It is `null` when the server cannot account for usage ("never a fabricated zero").

## Cancellation

- **[DOC]** `POST /v1/responses/{id}/cancel` is idempotent. `POST /v1/sessions/{sid}/cancel` cancels a whole session.
- **[DOC]** "Closing an SSE connection does not stop the server-side agent." Cancel explicitly.

## Files and artifacts

- **[DOC]** `POST /v1/files` (multipart, `file` plus optional `purpose`, 25 MiB max, 413 above that) returns `{ id: "file_…" }`. You reference the file with `{ "type": "input_file", "file_id": … }` inside a `{ role: "user", content: [...] }` input item.
- **[DOC]** `GET /v1/sessions/{sid}/files?changed=true` returns files with `id`, `file_id`, `container_id`, `filename`, `path`, `bytes`, `media_type`, `download_url`, `changed` and `produced`.
- **[DOC]** `GET /v1/containers/{cid}/files/{fid}/content` downloads one file. `GET /v1/sessions/{sid}/files/archive` returns a zip.
- **[DOC, security]** The skill says the browser must never see `download_url` or `harness_id`. AgentArena rebuilds download URLs from validated ids and never follows `download_url`.

## Errors and idempotency

- **[DOC]** Error envelope: `{ error: { type, code, message, param?, detail? } }`. Branch on `code`. The codes are: 400 `invalid_input`, 401 `invalid_credential`, 402 `payment_required`, 403 `insufficient_scope`, 404 `not_found`, 409 `conflict`, 413 `file_too_large`, 422 `invalid_request`, 429 `rate_limited`, 500/502/503/504 `internal_error`/`upstream_error`/`unavailable`/`timeout`.
- **[DOC]** `502 store_write_failed` means the work may already have run: recover the session, never resubmit.
- **[DOC]** `Idempotency-Key`: the same key with the same body returns the first result without re-executing. The same key with a different body returns `409`. A retry while the task is running waits for it.
- **[DOC]** No numeric rate limits are documented. The Arena docs say the Free plan's 7-day trial runs **2 tasks at once**, so AgentArena defaults to `MAX_CONCURRENT_RUNS=2`.

## Pricing and usage

- **[DOC]** The session object has `spend_usd` (sometimes a **string**) and `max_cost_usd`. The response object has no cost field.
- **[DOC]** Each Arena column is billed as its own task. `GET /v1/balance` exists **[SPEC]** but its response is not documented.
- **[ASSUMPTION]** `max_cost_usd` is a provider-side budget. AgentArena calls it a budget hint, **never a guaranteed spending cap**.

## Community Edition vs Cloud

| | Community Edition | Cloud |
|---|---|---|
| Deploy | `docker run -p 127.0.0.1:3000:3000 -v harnessrouter:/data harnessrouter/harnessrouter` (about 4 GB of disk) | Managed |
| Credentials | Console login (default `harnessrouter`/`harnessrouter`, change it), a provider API key ("Bring your own key"), and a CE API key | Workspace API key |
| Isolation | Per-session workspace **and OS user, not a container** [DOC] | "Serverless, isolated sandboxes" [DOC] |
| Cost | Model provider costs only | Billed tasks |
| License | Apache-2.0. Harness CLIs carry their own licenses | Commercial |
| Note | The official skill says its runtime target is "always Cloud", but the CE README documents the same API under `/api/harness`. | |

AgentArena supports both through `HR_BASE_URL`; `http://` is allowed only for loopback. **[UNVERIFIED]** Neither has been exercised live from this project.

## Tracing and observability

- **[DOC]** It accepts W3C `traceparent`/`tracestate`. `GET /v1/traces/{sid}` and `/events` expose traces **[SPEC]**. AgentArena does not use them yet (see the roadmap).

## Integration status

| Capability | Status |
|---|---|
| Discovery (`/v1/uhp`), listing harnesses | Implemented and contract-tested. **[UNVERIFIED live]** |
| Streaming task with `metadata.harness_id` and `Idempotency-Key` | Implemented and contract-tested. **[UNVERIFIED live]** |
| Starter-file upload as `input_file` | Implemented and contract-tested. **[UNVERIFIED live]** |
| Stream-drop recovery by polling | Implemented and contract-tested. **[UNVERIFIED live]** |
| Cancel on abort/timeout | Implemented and contract-tested. **[UNVERIFIED live]** |
| `spend_usd` and usage extraction | Implemented and contract-tested. **[UNVERIFIED live]** |
| Changed-file download via rebuilt URL | Implemented and contract-tested. **[UNVERIFIED live]** |
| Traces, continuation (`previous_response_id`), background mode | Not implemented |
