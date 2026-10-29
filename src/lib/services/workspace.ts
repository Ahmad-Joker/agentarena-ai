import type { PrismaClient } from "@prisma/client";
import { SIM_AGENTS } from "@/lib/fixtures/demo-agents";
import { LANGUAGES } from "@/lib/domain/schemas";

export const LOCAL_WORKSPACE_NAME = "Local workspace";

/** Single local workspace (no multi-user auth in the MVP — see docs/SECURITY.md). */
export async function ensureWorkspace(prisma: PrismaClient) {
  const existing = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return prisma.workspace.create({ data: { name: LOCAL_WORKSPACE_NAME } });
}

/** Makes sure the simulated demo agents exist. Idempotent. */
export async function ensureSimulatedAgents(prisma: PrismaClient, workspaceId: string) {
  for (const sim of SIM_AGENTS) {
    await prisma.agentConfiguration.upsert({
      where: { workspaceId_name: { workspaceId, name: sim.name } },
      create: {
        workspaceId,
        name: sim.name,
        description: sim.description,
        provider: "SIMULATED",
        mode: "DEMO",
        base: "simulated",
        languages: [...LANGUAGES],
        color: sim.color,
        runtimeNotes: { simKey: sim.key, simulated: true, tools: ["read_file", "write_file", "run_tests"], network: "none" },
      },
      update: { description: sim.description, color: sim.color },
    });
  }
}
