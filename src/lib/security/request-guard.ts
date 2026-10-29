/**
 * AgentArena is a local-only tool without user accounts. These checks keep it that way:
 *  - Host allowlist blocks DNS-rebinding attacks from malicious web pages.
 *  - Same-origin check on mutating requests blocks cross-site request forgery.
 */
const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isAllowedHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const hostname = hostHeader.startsWith("[")
    ? hostHeader.slice(0, hostHeader.indexOf("]") + 1)
    : (hostHeader.split(":")[0] ?? "");
  return ALLOWED_HOSTNAMES.has(hostname.toLowerCase());
}

export function isSameOriginMutation(method: string, originHeader: string | null, hostHeader: string | null): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return true;
  if (!originHeader || !hostHeader) return false;
  try {
    return new URL(originHeader).host === hostHeader;
  } catch {
    return false;
  }
}
