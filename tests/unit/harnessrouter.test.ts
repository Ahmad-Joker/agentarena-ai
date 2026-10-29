/**
 * Contract tests for the HarnessRouter client and live adapter.
 * Fixtures mirror the DOCUMENTED shapes (docs/HARNESSROUTER_RESEARCH.md); they are not recorded
 * live traffic. Passing these tests does not prove live compatibility.
 */
import { describe, expect, it } from "vitest";
import { HarnessRouterClient, extractFinalText, normalizeStreamEvent, parseSpendUsd } from "@/lib/harnessrouter/client";
import { HarnessRouterError } from "@/lib/harnessrouter/errors";
import { SseParser } from "@/lib/harnessrouter/sse";
import { HarnessRouterAgentAdapter } from "@/lib/agents/live-adapter";
import type { AgentRunRequest } from "@/lib/agents/types";
import type { AgentStreamEvent } from "@/lib/harnessrouter/types";
import { fakeFetch, jsonResponse, sseResponse } from "../support/fakes";

const KEY = "hr_test_secret_key_1234567890";
const BASE = "https://api.harnessrouter.example";

const created = { type: "response.created", sequence_number: 0, response: { id: "resp_1", status: "in_progress", output: [], metadata: { session_id: "sess_1" } } };
const completed = {
  type: "response.completed",
  sequence_number: 5,
  response: {
    id: "resp_1",
    status: "completed",
    model: "some-model",
    output: [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "progress note" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done.\n```ts\nexport function f() { return 1; }\n```" }] },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    metadata: { session_id: "sess_1" },
  },
};

function baseRoutes(overrides: Record<string, Parameters<typeof fakeFetch>[0][string]> = {}) {
  return fakeFetch({
    "GET /v1/uhp": () => jsonResponse({ versions: ["2026-09-28"], default_version: "2026-09-28" }),
    "POST /v1/files": () => jsonResponse({ id: "file_abc", object: "file", filename: "auth.ts", purpose: "user_data" }),
    "POST /v1/responses": () =>
      sseResponse([
        created,
        { type: "response.output_item.added", sequence_number: 1, item: { type: "function_call", name: "write_file", arguments: "" } },
        { type: "response.output_text.delta", sequence_number: 2, delta: "Done." },
        completed,
      ]),
    "GET /v1/sessions/sess_1": () => jsonResponse({ id: "sess_1", status: "done", spend_usd: "0.0421", usage: { total_tokens: 15 } }),
    "GET /v1/sessions/sess_1/files": () =>
      jsonResponse({
        session_id: "sess_1",
        count: 1,
        files: [{ object: "file", file_id: "cf_1", container_id: "sess_1", path: "auth.ts", download_url: "https://evil.example/steal", media_type: "text/plain" }],
      }),
    "GET /v1/containers/sess_1/files/cf_1/content": () => new Response("export function f() { return 2; }"),
    "POST /v1/responses/resp_1/cancel": () => jsonResponse({ id: "resp_1", status: "cancelled", output: [] }),
    ...overrides,
  });
}

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest & { events: AgentStreamEvent[] } {
  const events: AgentStreamEvent[] = [];
  return {
    idempotencyKey: "idem-123",
    agent: { id: "a1", name: "Agent", provider: "HARNESSROUTER", harnessId: "hr_agent_1", model: null },
    task: { language: "TYPESCRIPT", entryFile: "auth.ts", entryFunction: "f" },
    prompt: "Fix the bug",
    starterFiles: [{ path: "auth.ts", content: "export function f() { return 0; }" }],
    timeoutSeconds: 60,
    maxCostUsd: 1,
    signal: new AbortController().signal,
    onEvent: (e) => {
      events.push(e);
    },
    events,
    ...overrides,
  };
}

describe("SSE parser", () => {
  it("parses data-only frames split across arbitrary chunk boundaries", () => {
    const p = new SseParser();
    const text = 'data: {"type":"a","sequence_number":0}\r\n\r\ndata: {"type":"b"}\n\n';
    const out = text.split("").flatMap((ch) => p.push(ch));
    expect(out.map((e) => e.type)).toEqual(["a", "b"]);
  });

  it("drops malformed frames and [DONE]", () => {
    const p = new SseParser();
    expect(p.push("data: not json\n\ndata: [DONE]\n\ndata: {\"no_type\":1}\n\n")).toEqual([]);
    expect(p.push('data: {"type":"tail"}')).toEqual([]);
    expect(p.end().map((e) => e.type)).toEqual(["tail"]);
  });
});

describe("stream normalization", () => {
  it("maps documented terminal events, including cancellation via response.failed", () => {
    expect(normalizeStreamEvent(completed)).toMatchObject({ kind: "terminal", status: "completed" });
    expect(normalizeStreamEvent({ type: "response.incomplete", response: { id: "r", status: "incomplete", incomplete_details: { reason: "timeout" } } })).toMatchObject({
      kind: "terminal",
      status: "incomplete",
      reason: "timeout",
    });
    expect(normalizeStreamEvent({ type: "response.failed", response: { id: "r", status: "cancelled" } })).toMatchObject({ status: "cancelled" });
    expect(normalizeStreamEvent({ type: "response.failed", response: { id: "r", status: "failed", error: { code: "upstream_error" } } })).toMatchObject({ status: "failed", reason: "upstream_error" });
    expect(normalizeStreamEvent({ type: "some.future.event" })).toBeUndefined();
  });

  it("takes the answer from the LAST message item", () => {
    const parsed = normalizeStreamEvent(completed);
    expect(parsed?.kind === "terminal" && extractFinalText(parsed.response)).toContain("Done.");
  });

  it("parses string spend_usd values", () => {
    expect(parseSpendUsd({ spend_usd: "0.25" })).toBe(0.25);
    expect(parseSpendUsd({ spend_usd: "abc" })).toBeUndefined();
    expect(parseSpendUsd({ spend_usd: null })).toBeUndefined();
  });
});

describe("HarnessRouterClient", () => {
  it("sends documented headers and body on task creation", async () => {
    const f = baseRoutes();
    const client = new HarnessRouterClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: f.impl });
    const events = [];
    for await (const e of client.streamResponse({ harnessId: "hr_agent_1", input: "hi", idempotencyKey: "idem-1", timeoutSeconds: 30, maxCostUsd: 0.5 })) events.push(e);
    const post = f.requests.find((r) => r.method === "POST" && r.url.pathname === "/v1/responses")!;
    expect(post.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(post.headers.get("uhp-version")).toBe("2026-09-28");
    expect(post.headers.get("idempotency-key")).toBe("idem-1");
    expect(post.body).toMatchObject({ input: "hi", stream: true, metadata: { harness_id: "hr_agent_1" }, timeout_seconds: 30, max_cost_usd: 0.5 });
    expect(post.body).not.toHaveProperty("model");
    // Discovery is unauthenticated.
    expect(f.requests.find((r) => r.url.pathname === "/v1/uhp")!.headers.get("authorization")).toBeNull();
    expect(events.map((e) => e.kind)).toEqual(["created", "tool", "text_delta", "terminal"]);
  });

  it("normalizes the documented error envelope and redacts the key from messages", async () => {
    const f = baseRoutes({
      "GET /v1/harnesses": () => jsonResponse({ error: { type: "authentication_error", code: "invalid_credential", message: `bad key ${KEY}` } }, 401),
    });
    const client = new HarnessRouterClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: f.impl });
    const err = await client.listHarnesses().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HarnessRouterError);
    expect((err as HarnessRouterError).code).toBe("invalid_credential");
    expect((err as HarnessRouterError).message).not.toContain(KEY);
  });

  it("falls back to status-based codes when the body is not the envelope", async () => {
    const f = baseRoutes({ "GET /v1/harnesses": () => new Response("<html>", { status: 429 }) });
    const err = (await new HarnessRouterClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: f.impl }).listHarnesses().catch((e: unknown) => e)) as HarnessRouterError;
    expect(err.code).toBe("rate_limited");
    expect(err.retryable).toBe(true);
  });

  it("refuses to run without a key and never calls the network for it", async () => {
    const f = baseRoutes();
    const err = (await new HarnessRouterClient({ baseUrl: BASE, fetchImpl: f.impl }).listHarnesses().catch((e: unknown) => e)) as HarnessRouterError;
    expect(err.code).toBe("missing_credential");
    expect(f.requests).toHaveLength(0);
  });

  it("rejects unsafe base URLs and provider ids", async () => {
    expect(() => new HarnessRouterClient({ baseUrl: "http://example.com" })).toThrow();
    expect(() => new HarnessRouterClient({ baseUrl: "https://user:pw@example.com" })).toThrow();
    expect(() => new HarnessRouterClient({ baseUrl: "http://localhost:3000/api/harness" })).not.toThrow();
    const client = new HarnessRouterClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: baseRoutes().impl });
    await expect(client.getSession("../../admin")).rejects.toThrow(/unexpected session id/);
  });

  it("keeps the Community Edition path prefix", async () => {
    const f = fakeFetch({
      "GET /api/harness/v1/uhp": () => jsonResponse({ default_version: "2026-09-28" }),
      "GET /api/harness/v1/harnesses": () => jsonResponse({ harnesses: [{ id: "h1", name: "Codex", base: "codex", defaultModel: "m" }] }),
    });
    const list = await new HarnessRouterClient({ baseUrl: "http://localhost:3000/api/harness", apiKey: KEY, fetchImpl: f.impl }).listHarnesses();
    expect(list[0]).toMatchObject({ id: "h1", defaultModel: "m" });
  });
});

describe("HarnessRouterAgentAdapter", () => {
  it("runs the documented flow: upload → stream → session spend → changed files", async () => {
    const f = baseRoutes();
    const adapter = new HarnessRouterAgentAdapter(new HarnessRouterClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: f.impl }), 1);
    const req = request();
    const result = await adapter.run(req);
    expect(result).toMatchObject({ outcome: "completed", costUsd: 0.0421, costSource: "PROVIDER_REPORTED", responseId: "resp_1", sessionId: "sess_1" });
    expect(result.artifacts).toEqual([expect.objectContaining({ path: "auth.ts", content: "export function f() { return 2; }", source: "PROVIDER_FILE" })]);
    const post = f.requests.find((r) => r.method === "POST" && r.url.pathname === "/v1/responses")!;
    expect(post.body).toMatchObject({ input: [{ role: "user", content: [{ type: "input_file", file_id: "file_abc" }, { type: "input_text", text: "Fix the bug" }] }] });
    // The provider's download_url is never followed.
    expect(f.requests.some((r) => r.url.hostname === "evil.example")).toBe(false);
  });

  it("falls back to extracting code from the final message when no file was produced", async () => {
    const f = baseRoutes({ "GET /v1/sessions/sess_1/files": () => jsonResponse({ files: [] }) });
    const adapter = new HarnessRouterAgentAdapter(new HarnessRouterClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: f.impl }), 1);
    const result = await adapter.run(request());
    expect(result.artifacts[0]).toMatchObject({ source: "EXTRACTED_FROM_OUTPUT", content: "export function f() { return 1; }\n" });
  });

  it("recovers by polling when the stream drops without a terminal event (never resends)", async () => {
    let polls = 0;
    const f = baseRoutes({
      "POST /v1/responses": () => sseResponse([created]),
      "GET /v1/responses/resp_1": () => {
        polls++;
        return jsonResponse(polls < 2 ? { id: "resp_1", status: "in_progress", output: [] } : completed.response);
      },
    });
    const adapter = new HarnessRouterAgentAdapter(new HarnessRouterClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: f.impl }), 1);
    const result = await adapter.run(request());
    expect(result.outcome).toBe("completed");
    expect(f.requests.filter((r) => r.method === "POST" && r.url.pathname === "/v1/responses")).toHaveLength(1);
    expect(polls).toBe(2);
  });

  it("cancels the provider task when the run is aborted", async () => {
    const ctrl = new AbortController();
    const f = baseRoutes({
      "POST /v1/responses": () => sseResponse([created]),
      "GET /v1/responses/resp_1": () => {
        ctrl.abort(new Error("user cancel"));
        return jsonResponse({ id: "resp_1", status: "in_progress", output: [] });
      },
    });
    const adapter = new HarnessRouterAgentAdapter(new HarnessRouterClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: f.impl }), 1);
    await expect(adapter.run(request({ signal: ctrl.signal }))).rejects.toThrow("user cancel");
    expect(f.requests.some((r) => r.method === "POST" && r.url.pathname === "/v1/responses/resp_1/cancel")).toBe(true);
  });

  it("reports provider failures with their code", async () => {
    const f = baseRoutes({
      "POST /v1/responses": () => sseResponse([created, { type: "response.failed", response: { id: "resp_1", status: "failed", error: { code: "upstream_error", message: "model down" } } }]),
    });
    const adapter = new HarnessRouterAgentAdapter(new HarnessRouterClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: f.impl }), 1);
    expect(await adapter.run(request())).toMatchObject({ outcome: "failed", errorCode: "upstream_error" });
  });

  it("reports unavailable cost honestly when spend_usd is missing", async () => {
    const f = baseRoutes({ "GET /v1/sessions/sess_1": () => jsonResponse({ id: "sess_1", status: "done" }) });
    const adapter = new HarnessRouterAgentAdapter(new HarnessRouterClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: f.impl }), 1);
    const result = await adapter.run(request());
    expect(result.costSource).toBe("UNAVAILABLE");
    expect(result.costUsd).toBeUndefined();
  });
});
