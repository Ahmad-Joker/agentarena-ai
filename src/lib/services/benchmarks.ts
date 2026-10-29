import { randomUUID } from "node:crypto";
import type { ExecutionMode, Prisma, PrismaClient } from "@prisma/client";
import { buildBenchmarkPrompt, hashTask } from "@/lib/agents/prompt";
import { taskInputSchema, type CreateBenchmarkInput, type TaskInput } from "@/lib/domain/schemas";
import { PROFILE_WEIGHTS, normalizeWeights } from "@/lib/evaluation/scoring";

export class BenchmarkRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "BenchmarkRequestError";
  }
}

export interface CreateContext {
  prisma: PrismaClient;
  workspaceId: string;
  mode: ExecutionMode;
  liveAllowed: boolean;
}

/**
 * Validates and persists a benchmark plus one PENDING run per agent.
 * Fairness: every run shares one frozen prompt, one task snapshot and one set of limits.
 */
export async function createBenchmark(ctx: CreateContext, input: CreateBenchmarkInput) {
  const { prisma, workspaceId, mode } = ctx;

  if (mode === "LIVE") {
    if (!ctx.liveAllowed) throw new BenchmarkRequestError("live_disabled", "Live execution is disabled on this server.", 403);
    if (!input.confirmLiveSpend) {
      throw new BenchmarkRequestError("spend_not_confirmed", "Live benchmarks are billable. Confirm spending to continue.", 400);
    }
  }

  const task = input.taskId ? await loadTask(prisma, workspaceId, input.taskId) : await upsertTask(prisma, workspaceId, input.task!);
  const taskInput = taskInputSchema.parse({
    title: task.title,
    description: task.description,
    language: task.language,
    category: task.category,
    starterFiles: task.starterFiles,
    entryFile: task.entryFile,
    entryFunction: task.entryFunction,
    expectedBehavior: task.expectedBehavior,
    testSpec: task.testSpec ?? [],
    constraints: task.constraints ?? undefined,
  });

  const agents = await prisma.agentConfiguration.findMany({ where: { id: { in: input.agentIds }, workspaceId } });
  if (agents.length !== input.agentIds.length) throw new BenchmarkRequestError("unknown_agent", "One or more agents do not exist.", 404);
  for (const agent of agents) {
    if (!agent.isActive) throw new BenchmarkRequestError("inactive_agent", `${agent.name} is disabled.`);
    // Never mix simulated and live agents, and never run simulated agents as "live".
    if (agent.mode !== mode) {
      throw new BenchmarkRequestError("mode_mismatch", `${agent.name} is a ${agent.mode} agent but the server runs in ${mode} mode.`);
    }
    if (!agent.languages.includes(task.language)) {
      throw new BenchmarkRequestError("unsupported_language", `${agent.name} is not configured for ${task.language}.`);
    }
    if (agent.provider === "HARNESSROUTER" && !agent.harnessId) {
      throw new BenchmarkRequestError("invalid_agent", `${agent.name} has no HarnessRouter harness id.`);
    }
  }

  const weights = normalizeWeights(input.weights ?? PROFILE_WEIGHTS[input.profile]);
  const prompt = buildBenchmarkPrompt(taskInput);

  return prisma.benchmark.create({
    data: {
      workspaceId,
      taskId: task.id,
      mode,
      profile: input.profile,
      weights,
      timeoutSeconds: input.timeoutSeconds,
      maxConcurrency: Math.min(input.maxConcurrency, input.agentIds.length),
      maxCostUsd: input.maxCostUsd ?? null,
      promptSnapshot: prompt,
      runs: {
        create: agents.map((agent) => ({
          agentId: agent.id,
          idempotencyKey: randomUUID(),
          configSnapshot: {
            name: agent.name,
            provider: agent.provider,
            harnessId: agent.harnessId,
            base: agent.base,
            model: agent.model ?? "harness default",
            runtimeNotes: agent.runtimeNotes,
            timeoutSeconds: input.timeoutSeconds,
            maxCostUsd: input.maxCostUsd ?? null,
          } as Prisma.InputJsonValue,
        })),
      },
    },
    include: { runs: true },
  });
}

async function loadTask(prisma: PrismaClient, workspaceId: string, id: string) {
  const task = await prisma.codingTask.findFirst({ where: { id, workspaceId } });
  if (!task) throw new BenchmarkRequestError("unknown_task", "Task not found.", 404);
  return task;
}

/** Tasks are deduplicated by content hash so identical tasks aggregate together in analytics. */
export async function upsertTask(prisma: PrismaClient, workspaceId: string, input: TaskInput, isFixture = false) {
  const contentHash = hashTask(input);
  const existing = await prisma.codingTask.findFirst({ where: { workspaceId, contentHash } });
  if (existing) return existing;
  return prisma.codingTask.create({
    data: {
      workspaceId,
      title: input.title,
      description: input.description,
      language: input.language,
      category: input.category,
      starterFiles: input.starterFiles,
      entryFile: input.entryFile,
      entryFunction: input.entryFunction,
      expectedBehavior: input.expectedBehavior,
      testSpec: input.testSpec as Prisma.InputJsonValue,
      constraints: (input.constraints ?? undefined) as Prisma.InputJsonValue | undefined,
      contentHash,
      isFixture,
    },
  });
}
