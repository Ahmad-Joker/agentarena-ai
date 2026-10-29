/**
 * Redaction for anything that may end up in logs, the database or the browser.
 * Third-party responses and agent output are untrusted and may echo credentials.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:hr|sk|pk|rk|ghp|gho|ghs|xox[abprs])[-_][A-Za-z0-9_-]{12,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(api[_-]?key|token|secret|password|passwd|authorization)\b(\s*["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi,
];

const SENSITIVE_KEYS = /^(authorization|api[_-]?key|x-api-key|hr_api_key|token|access_token|refresh_token|secret|password|cookie|set-cookie|download_url)$/i;

export function redactString(input: string, extraSecrets: readonly string[] = []): string {
  let out = input;
  for (const secret of extraSecrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[REDACTED]");
  }
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, ...groups: unknown[]) => {
      // key=value form keeps the key for debuggability.
      if (typeof groups[0] === "string" && typeof groups[1] === "string" && typeof groups[2] === "string") {
        return `${groups[0]}${groups[1]}[REDACTED]`;
      }
      return match.toLowerCase().startsWith("bearer") ? "Bearer [REDACTED]" : "[REDACTED]";
    });
  }
  return out;
}

/** Deep-redacts objects: sensitive keys are masked, strings are pattern-scrubbed. */
export function redactDeep<T>(value: T, extraSecrets: readonly string[] = [], depth = 0): T {
  if (depth > 12) return "[TRUNCATED]" as unknown as T;
  if (typeof value === "string") return redactString(value, extraSecrets) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, extraSecrets, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[REDACTED]" : redactDeep(v, extraSecrets, depth + 1);
    }
    return out as T;
  }
  return value;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}
