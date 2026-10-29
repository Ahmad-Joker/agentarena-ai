import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrchestrator } from "@/lib/runtime";
import { ID_PATTERN, handleApiError, jsonError } from "@/lib/api";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ID_PATTERN.test(id)) return jsonError(400, "invalid_id", "Invalid benchmark id");
    const bench = await prisma.benchmark.findUnique({ where: { id }, select: { status: true } });
    if (!bench) return jsonError(404, "not_found", "Benchmark not found");
    if (bench.status !== "PENDING" && bench.status !== "RUNNING") return jsonError(409, "not_running", "Benchmark is already finished");
    await (await getOrchestrator()).cancelBenchmark(id);
    return NextResponse.json({ cancelled: true });
  } catch (err) {
    return handleApiError(err);
  }
}
