import { createHash } from "node:crypto";
import { normalizeStreamEvent } from "@/lib/harnessrouter/client";
import type { RawStreamEvent } from "@/lib/harnessrouter/sse";
import { fallbackSolution, findSimAgent, type SimOutcome } from "@/lib/fixtures/demo-agents";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "./types";

/**
 * DEMO adapter: replays deterministic, UHP-shaped event scripts through the *same*
 * normalizer the live adapter uses, so the orchestrator, persistence and UI exercise
 * identical code paths. It performs no network calls and costs nothing.
 *
 * Everything it produces (timings, tokens, cost) is SIMULATED and labelled as such.
 */
export class DemoAgentAdapter implements AgentAdapter {
  readonly kind = "SIMULATED" as const;

  /** timeScale 1 = realistic pacing for demos; 0 = instant (tests, seeding). */
  constructor(private readonly timeScale = 1) {}

  async run(req: AgentRunRequest): Promise<AgentRunResult> {
    const sim = findSimAgent(req.agent.simKey);
    if (!sim) {
      return {
        outcome: "failed",
        artifacts: [],
        costSource: "UNAVAILABLE",
        errorCode: "unknown_simulated_agent",
        errorMessage: "This simulated agent has no fixture personality.",
      };
    }
    const outcome: SimOutcome = (req.task.fixtureKey && sim.outcomes[req.task.fixtureKey]) || {
      kind: "solution",
      code: fallbackSolution(req.task.language, req.task.entryFunction),
      summary: "No fixture exists for custom tasks; returned a stub.",
    };

    const seed = deterministicSeed(`${sim.key}:${req.task.fixtureKey ?? req.task.entryFunction}`);
    const responseId = `resp_sim_${seed.slice(0, 16)}`;
    const sessionId = `sess_sim_${seed.slice(16, 32)}`;
    const step = async (ev: RawStreamEvent, multiplier = 1) => {
      await this.sleep(sim.stepMs * multiplier, req.signal);
      const normalized = normalizeStreamEvent(ev);
      if (normalized) await req.onEvent(normalized);
    };

    let seq = 0;
    const base = { id: responseId, status: "in_progress", output: [], metadata: { session_id: sessionId } };
    await step({ type: "response.created", sequence_number: seq++, response: base }, 0.3);
    await step({ type: "response.in_progress", sequence_number: seq++, response: base });
    await step({ type: "response.output_item.added", sequence_number: seq++, item: { type: "function_call", name: "read_file", arguments: "" } });
    await step({ type: "response.output_item.added", sequence_number: seq++, item: { type: "reasoning" } }, 1.5);

    if (outcome.kind === "provider_failure") {
      await step({ type: "response.output_item.added", sequence_number: seq++, item: { type: "function_call", name: "shell", arguments: "" } });
      await step({
        type: "response.failed",
        sequence_number: seq++,
        response: { ...base, status: "failed", error: { code: outcome.code, message: outcome.message } },
      });
      return {
        outcome: "failed",
        artifacts: [],
        costSource: "SIMULATED",
        costUsd: round6((900 / 1000) * sim.simulatedUsdPer1kTokens),
        usage: { input_tokens: 700, output_tokens: 200, total_tokens: 900 },
        errorCode: outcome.code,
        errorMessage: outcome.message,
        responseId,
        sessionId,
      };
    }

    if (outcome.kind === "provider_timeout") {
      for (let i = 0; i < 3; i++) {
        await step({ type: "response.output_item.added", sequence_number: seq++, item: { type: "function_call", name: "run_tests", arguments: "" } });
      }
      await step({
        type: "response.incomplete",
        sequence_number: seq++,
        response: { ...base, status: "incomplete", incomplete_details: { reason: "timeout" } },
      });
      return {
        outcome: "incomplete",
        reason: "timeout",
        artifacts: [],
        costSource: "SIMULATED",
        costUsd: round6((4200 / 1000) * sim.simulatedUsdPer1kTokens),
        usage: { input_tokens: 3600, output_tokens: 600, total_tokens: 4200 },
        responseId,
        sessionId,
      };
    }

    await step({ type: "response.output_item.added", sequence_number: seq++, item: { type: "function_call", name: "write_file", arguments: "" } }, 1.5);
    await step({ type: "response.output_item.added", sequence_number: seq++, item: { type: "function_call", name: "run_tests", arguments: "" } });
    const fenceLang = req.task.language === "PYTHON" ? "python" : req.task.language === "JAVASCRIPT" ? "js" : "ts";
    const finalText = `${outcome.summary}\n\n\`\`\`${fenceLang}\n${outcome.code}\`\`\``;
    for (const chunk of chunkText(finalText, 4)) {
      await step({ type: "response.output_text.delta", sequence_number: seq++, delta: chunk, item_id: "msg_1", output_index: 0 }, 0.25);
    }
    const tokensOut = Math.ceil(outcome.code.length / 3.5) + 120;
    const tokensIn = 1100 + (seed.charCodeAt(0) % 9) * 50;
    await step({
      type: "response.completed",
      sequence_number: seq++,
      response: {
        ...base,
        status: "completed",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: finalText }] }],
        usage: { input_tokens: tokensIn, output_tokens: tokensOut, total_tokens: tokensIn + tokensOut },
      },
    });

    return {
      outcome: "completed",
      finalText,
      artifacts: [{ path: req.task.entryFile, content: outcome.code, mediaType: "text/plain", source: "SIMULATED_FIXTURE" }],
      usage: { input_tokens: tokensIn, output_tokens: tokensOut, total_tokens: tokensIn + tokensOut },
      costUsd: round6(((tokensIn + tokensOut) / 1000) * sim.simulatedUsdPer1kTokens),
      costSource: "SIMULATED",
      responseId,
      sessionId,
    };
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const scaled = Math.round(ms * this.timeScale);
    if (scaled <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, scaled);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function deterministicSeed(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function chunkText(text: string, parts: number): string[] {
  const size = Math.ceil(text.length / parts);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
