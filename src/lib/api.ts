import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type z, type ZodTypeAny } from "zod";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { ensureSimulatedAgents, ensureWorkspace } from "@/lib/services/workspace";
import { BenchmarkRequestError } from "@/lib/services/benchmarks";
import { HarnessRouterError, describeError } from "@/lib/harnessrouter/errors";

const MAX_BODY_BYTES = 256 * 1024;

export function jsonError(status: number, code: string, message: string, issues?: unknown) {
  return NextResponse.json({ error: { code, message, ...(issues ? { issues } : {}) } }, { status });
}

/** Reads and validates a JSON body with a hard size limit. */
export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) throw new BenchmarkRequestError("payload_too_large", "Request body too large", 413);
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new BenchmarkRequestError("payload_too_large", "Request body too large", 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BenchmarkRequestError("invalid_json", "Body is not valid JSON");
  }
  return schema.parse(raw);
}

/** Maps known errors to safe responses; never leaks stack traces or upstream bodies. */
export function handleApiError(err: unknown) {
  if (err instanceof ZodError) {
    return jsonError(422, "validation_error", "Request validation failed", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  if (err instanceof BenchmarkRequestError) return jsonError(err.httpStatus, err.code, err.message);
  if (err instanceof HarnessRouterError) return jsonError(502, `harnessrouter_${err.code}`, describeError(err));
  console.error("[api] unexpected error", err instanceof Error ? err.message : err);
  return jsonError(500, "internal_error", "Unexpected server error");
}

export async function getRequestContext() {
  const env = getEnv();
  const workspace = await ensureWorkspace(prisma);
  if (env.AGENTARENA_MODE === "DEMO") await ensureSimulatedAgents(prisma, workspace.id);
  return {
    prisma,
    workspaceId: workspace.id,
    mode: env.AGENTARENA_MODE,
    liveAllowed: env.AGENTARENA_MODE === "LIVE" && env.ALLOW_LIVE_EXECUTION && Boolean(env.HR_API_KEY),
  };
}

export const ID_PATTERN = /^c[a-z0-9]{20,32}$/;
