import type { AgentStreamEvent, ProviderUsage } from "@/lib/harnessrouter/types";
import type { StarterFile } from "@/lib/domain/schemas";

export interface AgentDescriptor {
  id: string;
  name: string;
  provider: "SIMULATED" | "HARNESSROUTER";
  harnessId?: string | null;
  model?: string | null;
  /** For simulated agents: which fixture personality to use. */
  simKey?: string;
}

export interface TaskDescriptor {
  language: "TYPESCRIPT" | "JAVASCRIPT" | "PYTHON";
  entryFile: string;
  entryFunction: string;
  /** Set when the task matches a built-in fixture (demo agents only have solutions for these). */
  fixtureKey?: string;
}

export interface AgentRunRequest {
  idempotencyKey: string;
  agent: AgentDescriptor;
  task: TaskDescriptor;
  prompt: string;
  starterFiles: StarterFile[];
  timeoutSeconds: number;
  maxCostUsd?: number;
  signal: AbortSignal;
  onEvent: (event: AgentStreamEvent) => void | Promise<void>;
}

export interface CollectedArtifact {
  path: string;
  content: string;
  mediaType: string;
  source: "PROVIDER_FILE" | "EXTRACTED_FROM_OUTPUT" | "SIMULATED_FIXTURE";
}

export type AgentOutcome = "completed" | "incomplete" | "failed" | "cancelled";

export interface AgentRunResult {
  outcome: AgentOutcome;
  /** For incomplete runs: provider reason (documented values: max_steps, timeout). */
  reason?: string;
  finalText?: string;
  artifacts: CollectedArtifact[];
  usage?: ProviderUsage;
  costUsd?: number;
  costSource: "PROVIDER_REPORTED" | "SIMULATED" | "UNAVAILABLE";
  errorCode?: string;
  errorMessage?: string;
  responseId?: string;
  sessionId?: string;
}

export interface AgentAdapter {
  readonly kind: "SIMULATED" | "HARNESSROUTER";
  run(req: AgentRunRequest): Promise<AgentRunResult>;
}
