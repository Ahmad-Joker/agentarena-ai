import { HarnessRouterClient, extractFinalText, parseSpendUsd } from "@/lib/harnessrouter/client";
import { HarnessRouterError } from "@/lib/harnessrouter/errors";
import type { InputContent, ResponseObject } from "@/lib/harnessrouter/types";
import { extractCodeBlock } from "./prompt";
import type { AgentAdapter, AgentOutcome, AgentRunRequest, AgentRunResult, CollectedArtifact } from "./types";

const POLL_INTERVAL_MS = 3_000;
const MAX_ARTIFACTS = 10;
const TEXT_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|py|json|md|txt)$/i;

/**
 * LIVE adapter over HarnessRouter. Implements the documented flow:
 *  1. upload starter files (POST /v1/files) → input_file blocks
 *  2. POST /v1/responses with stream:true and metadata.harness_id, Idempotency-Key
 *  3. if the stream drops without a terminal event, poll GET /v1/responses/{id} — never resend
 *  4. on abort (user cancel / orchestrator timeout) call POST /v1/responses/{id}/cancel
 *  5. read spend_usd + usage from GET /v1/sessions/{sid}; fetch changed files
 *
 * Status: implemented against documented contracts and contract-tested with fixtures.
 * NOT yet verified against a real HarnessRouter account (see docs/KNOWN_LIMITATIONS.md).
 */
export class HarnessRouterAgentAdapter implements AgentAdapter {
  readonly kind = "HARNESSROUTER" as const;

  constructor(
    private readonly client: HarnessRouterClient,
    private readonly pollIntervalMs = POLL_INTERVAL_MS,
  ) {}

  async run(req: AgentRunRequest): Promise<AgentRunResult> {
    if (!req.agent.harnessId) {
      return { outcome: "failed", artifacts: [], costSource: "UNAVAILABLE", errorCode: "missing_harness_id", errorMessage: "Agent has no harness id" };
    }

    const content: InputContent[] = [];
    for (const file of req.starterFiles) {
      content.push({ type: "input_file", file_id: await this.client.uploadFile(file.path, file.content) });
    }
    content.push({ type: "input_text", text: req.prompt });

    let responseId: string | undefined;
    let sessionId: string | undefined;
    let terminal: { status: AgentOutcome; response?: ResponseObject; reason?: string } | undefined;
    let streamedText = "";

    try {
      for await (const ev of this.client.streamResponse({
        harnessId: req.agent.harnessId,
        model: req.agent.model ?? undefined,
        input: [{ role: "user", content }],
        idempotencyKey: req.idempotencyKey,
        timeoutSeconds: req.timeoutSeconds,
        maxCostUsd: req.maxCostUsd,
        signal: req.signal,
      })) {
        if (ev.kind === "created") {
          responseId = ev.responseId;
          sessionId = ev.sessionId;
        } else if (ev.kind === "text_delta") {
          streamedText += ev.delta;
        } else if (ev.kind === "terminal") {
          terminal = { status: ev.status, response: ev.response, reason: ev.reason };
        }
        await req.onEvent(ev);
      }

      // Documented recovery: stream ended without a terminal event → poll, do not resend.
      while (!terminal && responseId) {
        await abortableDelay(this.pollIntervalMs, req.signal);
        const polled = await this.client.getResponse(responseId);
        sessionId ??= polled.metadata?.session_id;
        if (["completed", "incomplete", "failed", "cancelled"].includes(polled.status)) {
          terminal = { status: polled.status as AgentOutcome, response: polled, reason: polled.incomplete_details?.reason ?? polled.error?.code };
          await req.onEvent({ kind: "progress", message: `Recovered final status by polling: ${polled.status}`, raw: "poll" });
        }
      }
    } catch (err) {
      if (req.signal.aborted && responseId) {
        // Closing the stream does not stop server-side work (documented) — cancel explicitly.
        await this.client.cancelResponse(responseId).catch(() => undefined);
      }
      throw err;
    }

    if (!terminal) {
      return {
        outcome: "failed",
        artifacts: [],
        costSource: "UNAVAILABLE",
        errorCode: "no_terminal_event",
        errorMessage: "Stream closed before the task was created",
        responseId,
        sessionId,
      };
    }

    const finalText = extractFinalText(terminal.response) ?? (streamedText || undefined);
    const result: AgentRunResult = {
      outcome: terminal.status,
      reason: terminal.reason,
      finalText,
      artifacts: [],
      usage: terminal.response?.usage ?? undefined,
      costSource: "UNAVAILABLE",
      responseId,
      sessionId,
      errorCode: terminal.status === "failed" ? (terminal.response?.error?.code ?? "failed") : undefined,
      errorMessage: terminal.status === "failed" ? terminal.response?.error?.message : undefined,
    };

    if (sessionId) {
      try {
        const session = await this.client.getSession(sessionId);
        const spend = parseSpendUsd(session);
        if (spend !== undefined) {
          result.costUsd = spend;
          result.costSource = "PROVIDER_REPORTED";
        }
        result.usage ??= session.usage ?? undefined;
      } catch (err) {
        if (!(err instanceof HarnessRouterError)) throw err;
      }
      result.artifacts = await this.collectArtifacts(sessionId, req).catch(() => []);
    }

    if (finalText && !result.artifacts.some((a) => a.path === req.task.entryFile)) {
      const code = extractCodeBlock(finalText, req.task.language);
      if (code) result.artifacts.push({ path: req.task.entryFile, content: code, mediaType: "text/plain", source: "EXTRACTED_FROM_OUTPUT" });
    }
    return result;
  }

  private async collectArtifacts(sessionId: string, req: AgentRunRequest): Promise<CollectedArtifact[]> {
    const files = await this.client.listChangedFiles(sessionId);
    const out: CollectedArtifact[] = [];
    for (const f of files.slice(0, MAX_ARTIFACTS)) {
      const path = f.path ?? f.filename;
      const fileId = f.file_id ?? f.id;
      if (!path || !fileId || !f.container_id || !TEXT_EXTENSIONS.test(path)) continue;
      const normalizedPath = path.replace(/^\/+/, "").split("/").slice(-3).join("/");
      const content = await this.client.downloadFileText(f.container_id, fileId);
      out.push({ path: normalizedPath, content, mediaType: f.media_type ?? "text/plain", source: "PROVIDER_FILE" });
    }
    // Prefer the exact entry file when the provider returned it under a nested path.
    const entry = out.find((a) => a.path === req.task.entryFile || a.path.endsWith(`/${req.task.entryFile}`));
    if (entry) entry.path = req.task.entryFile;
    return out;
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
