import { prisma } from "@/lib/db";
import { ID_PATTERN, handleApiError, jsonError } from "@/lib/api";

/**
 * Downloads a stored artifact as an inert text attachment. Generated code is never
 * served as HTML/JS from the app origin (nosniff + attachment + sandbox CSP).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ID_PATTERN.test(id)) return jsonError(400, "invalid_id", "Invalid artifact id");
    const artifact = await prisma.artifact.findUnique({ where: { id }, select: { path: true, content: true } });
    if (!artifact || artifact.content === null) return jsonError(404, "not_found", "Artifact not found");
    const filename = artifact.path.split("/").pop()!.replace(/[^A-Za-z0-9._-]/g, "_");
    return new Response(artifact.content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
