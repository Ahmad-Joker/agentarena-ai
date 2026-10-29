import { NextResponse, type NextRequest } from "next/server";
import { isAllowedHost, isSameOriginMutation } from "@/lib/security/request-guard";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  if (!isAllowedHost(host)) {
    return new NextResponse("AgentArena only serves loopback hosts (localhost / 127.0.0.1).", { status: 421 });
  }
  if (req.nextUrl.pathname.startsWith("/api/") && !isSameOriginMutation(req.method, req.headers.get("origin"), host)) {
    return NextResponse.json({ error: { code: "cross_origin_rejected", message: "Cross-origin request rejected" } }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
