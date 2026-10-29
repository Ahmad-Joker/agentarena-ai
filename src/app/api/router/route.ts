import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { routeQuerySchema } from "@/lib/domain/schemas";
import { classifyTask } from "@/lib/routing/classifier";
import { recommend } from "@/lib/routing/engine";
import { loadRunRecords } from "@/lib/services/queries";
import { getRequestContext, handleApiError, parseBody } from "@/lib/api";

export async function POST(req: Request) {
  try {
    const ctx = await getRequestContext();
    const query = await parseBody(req, routeQuerySchema);
    const classification = classifyTask(query.description);
    const language = query.language ?? classification.language;
    const category = query.category ?? classification.category;

    const [records, agents] = await Promise.all([
      loadRunRecords(ctx.prisma, ctx.mode),
      ctx.prisma.agentConfiguration.findMany({ where: { workspaceId: ctx.workspaceId, mode: ctx.mode } }),
    ]);
    const decision = recommend({ language, category, objective: query.objective }, records, agents);

    await ctx.prisma.routingRecommendation.create({
      data: {
        workspaceId: ctx.workspaceId,
        mode: ctx.mode,
        query: query.description,
        language: language ?? null,
        category: category ?? null,
        objective: query.objective,
        recommendedAgentId: decision.recommended?.agentId ?? null,
        alternativeAgentId: decision.alternative?.agentId ?? null,
        confidence: decision.confidence,
        explanation: JSON.parse(JSON.stringify({ ...decision, classification })) as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ mode: ctx.mode, classification, resolved: { language, category }, decision });
  } catch (err) {
    return handleApiError(err);
  }
}
