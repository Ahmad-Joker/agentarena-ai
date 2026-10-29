import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getHarnessRouterClient } from "@/lib/runtime";
import { handleApiError, jsonError } from "@/lib/api";

/**
 * Lists configured agents visible to the server's Workspace key (GET /v1/harnesses).
 * Read-only and free: it starts no tasks. Only id/name/base/default model are returned.
 */
export async function POST() {
  try {
    const env = getEnv();
    if (!env.HR_API_KEY) return jsonError(409, "not_configured", "HR_API_KEY is not configured on the server.");
    const harnesses = await getHarnessRouterClient().listHarnesses();
    return NextResponse.json({
      harnesses: harnesses.slice(0, 100).map((h) => ({ id: h.id, name: h.name ?? h.id, base: h.base ?? null, defaultModel: h.defaultModel ?? null })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
