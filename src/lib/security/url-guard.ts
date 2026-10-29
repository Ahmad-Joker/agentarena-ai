/**
 * SSRF protection for outbound requests.
 *
 * AgentArena only ever talks to the configured HarnessRouter base URL. URLs that
 * arrive in third-party responses (e.g. a file's `download_url`) are never fetched
 * directly; download paths are rebuilt from validated ids against the base URL.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/**
 * Validates the operator-configured HarnessRouter base URL.
 * HTTPS is required except for loopback (Community Edition on the same machine).
 */
export function validateBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("HarnessRouter base URL is not a valid URL");
  }
  if (url.username || url.password) throw new UnsafeUrlError("Credentials in the base URL are not allowed");
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new UnsafeUrlError("HarnessRouter base URL must use https (http is only allowed for localhost)");
  }
  if (url.search || url.hash) throw new UnsafeUrlError("Base URL must not include a query string or fragment");
  return url;
}

/** Path segment ids returned by the provider (resp_…, file_…, session ids). */
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

export function assertSafeId(id: unknown, label: string): string {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new UnsafeUrlError(`Refusing to use an unexpected ${label} from the provider response`);
  }
  return id;
}

/** Joins base + path while guaranteeing the result stays on the base origin and path prefix. */
export function buildProviderUrl(base: URL, path: string, query?: Record<string, string>): URL {
  if (!path.startsWith("/") || path.includes("..") || path.includes("//")) {
    throw new UnsafeUrlError("Invalid provider path");
  }
  const prefix = base.pathname.replace(/\/+$/, "");
  const url = new URL(base.origin);
  url.pathname = `${prefix}${path}`;
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  if (url.origin !== base.origin) throw new UnsafeUrlError("Provider URL escaped the configured origin");
  return url;
}
