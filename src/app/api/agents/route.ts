import { NextResponse } from "next/server";
import { agentConfigInputSchema } from "@/lib/domain/schemas";
import { BenchmarkRequestError } from "@/lib/services/benchmarks";
import { getRequestContext, handleApiError, parseBody } from "@/lib/api";

const PALETTE = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb923c"];

export async function GET() {
  try {
    const ctx = await getRequestContext();
    const agents = await ctx.prisma.agentConfiguration.findMany({
      where: { workspaceId: ctx.workspaceId, mode: ctx.mode },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, description: true, provider: true, base: true, model: true, languages: true, color: true, isActive: true },
    });
    return NextResponse.json({ mode: ctx.mode, agents });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Registers a HarnessRouter configured agent (LIVE mode only). The harness id stays server-side afterwards. */
export async function POST(req: Request) {
  try {
    const ctx = await getRequestContext();
    if (ctx.mode !== "LIVE") throw new BenchmarkRequestError("demo_mode", "HarnessRouter agents can only be added in LIVE mode.", 409);
    const input = await parseBody(req, agentConfigInputSchema);
    const count = await ctx.prisma.agentConfiguration.count({ where: { workspaceId: ctx.workspaceId } });
    const agent = await ctx.prisma.agentConfiguration.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        description: input.description,
        provider: "HARNESSROUTER",
        mode: "LIVE",
        harnessId: input.harnessId,
        base: input.base,
        model: input.model || null,
        languages: input.languages,
        color: input.color ?? PALETTE[count % PALETTE.length]!,
        runtimeNotes: { source: "user-configured", modelOverride: Boolean(input.model) },
      },
      select: { id: true, name: true },
    });
    return NextResponse.json(agent, { status: 201 });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return handleApiError(new BenchmarkRequestError("duplicate_name", "An agent with this name already exists.", 409));
    }
    return handleApiError(err);
  }
}
