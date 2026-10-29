import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrchestrator } from "@/lib/runtime";
import { ID_PATTERN, handleApiError, jsonError } from "@/lib/api";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ID_PATTERN.test(id)) return jsonError(400, "invalid_id", "Invalid run id");
    const run = await prisma.agentRun.findUnique({ where: { id }, select: { status: true } });
    if (!run) return jsonError(404, "not_found", "Run not found");
    if (run.status !== "PENDING" && run.status !== "RUNNING") return jsonError(409, "not_running", "Run is already finished");
    await (await getOrchestrator()).cancelRun(id);
    return NextResponse.json({ cancelled: true });
  } catch (err) {
    return handleApiError(err);
  }
}
