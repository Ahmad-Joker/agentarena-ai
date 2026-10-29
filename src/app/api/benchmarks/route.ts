import { NextResponse } from "next/server";
import { createBenchmarkSchema } from "@/lib/domain/schemas";
import { createBenchmark } from "@/lib/services/benchmarks";
import { listBenchmarks } from "@/lib/services/queries";
import { getRequestContext, handleApiError, parseBody } from "@/lib/api";
import { getOrchestrator } from "@/lib/runtime";

export async function GET(req: Request) {
  try {
    const ctx = await getRequestContext();
    const url = new URL(req.url);
    const rows = await listBenchmarks(ctx.prisma, ctx.mode, {
      status: url.searchParams.get("status") ?? undefined,
      language: url.searchParams.get("language") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      q: url.searchParams.get("q")?.slice(0, 100) ?? undefined,
    });
    return NextResponse.json({ benchmarks: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getRequestContext();
    const input = await parseBody(req, createBenchmarkSchema);
    // Initialise first so restart reconciliation never sees the benchmark created below.
    const orchestrator = await getOrchestrator();
    const bench = await createBenchmark(ctx, input);
    // Runs continue in the server process; the client follows progress via GET /api/benchmarks/:id.
    void orchestrator.start(bench.id).catch((err) => console.error("[benchmarks] start failed", err instanceof Error ? err.message : err));
    return NextResponse.json({ id: bench.id }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
