import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getBenchmarkDetail } from "@/lib/services/queries";
import { toBenchmarkDto } from "@/lib/services/dto";
import { ID_PATTERN, handleApiError, jsonError } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ID_PATTERN.test(id)) return jsonError(400, "invalid_id", "Invalid benchmark id");
    const detail = await getBenchmarkDetail(prisma, id);
    if (!detail) return jsonError(404, "not_found", "Benchmark not found");
    return NextResponse.json(toBenchmarkDto(detail), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleApiError(err);
  }
}
