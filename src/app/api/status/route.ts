import { NextResponse } from "next/server";
import { getPublicEnvStatus } from "@/lib/env";
import { getSandbox } from "@/lib/runtime";
import { prisma } from "@/lib/db";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const env = getPublicEnvStatus();
    const sandbox = getSandbox();
    const [node, python, db] = await Promise.all([
      sandbox.isAvailable("TYPESCRIPT"),
      sandbox.isAvailable("PYTHON"),
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    ]);
    return NextResponse.json({ ...env, database: db, sandbox: { node, python } }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleApiError(err);
  }
}
