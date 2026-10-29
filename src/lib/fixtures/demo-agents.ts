/**
 * SIMULATED agent configurations for DEMO mode.
 *
 * These are not real HarnessRouter harnesses and do not represent any vendor's product.
 * Each has a deterministic "personality" so every UI state (pass, partial pass, failure,
 * provider-reported timeout, cancellation) can be demonstrated without spending money.
 * Their solutions are fixed strings; the evaluation of those solutions is real.
 */
export type SimOutcome =
  | { kind: "solution"; code: string; summary: string }
  | { kind: "provider_failure"; code: string; message: string }
  | { kind: "provider_timeout" };

export interface SimAgent {
  key: string;
  name: string;
  description: string;
  color: string;
  /** Simulated wall-clock pacing in ms per scripted step. */
  stepMs: number;
  /** Simulated cost per 1k tokens, used only to produce clearly-labelled SIMULATED cost figures. */
  simulatedUsdPer1kTokens: number;
  outcomes: Record<string, SimOutcome>;
}

const FALLBACK_TS = (fn: string) => `export function ${fn}(..._args: unknown[]): never {\n  throw new Error("Simulated agent has no solution for custom tasks");\n}\n`;
const FALLBACK_PY = (fn: string) => `def ${fn}(*_args):\n    raise NotImplementedError("Simulated agent has no solution for custom tasks")\n`;

export function fallbackSolution(language: string, fn: string): string {
  return language === "PYTHON" ? FALLBACK_PY(fn) : FALLBACK_TS(fn);
}

export const SIM_AGENTS: SimAgent[] = [
  {
    key: "sim-swift",
    name: "Sim · Swift Drafter",
    description: "Simulated agent tuned for speed: answers quickly, sometimes misses edge cases.",
    color: "#38bdf8",
    stepMs: 450,
    simulatedUsdPer1kTokens: 0.002,
    outcomes: {
      "auth-token-expiry": {
        kind: "solution",
        summary: "Converted exp to milliseconds before comparing.",
        code: `export interface TokenClaims {
  exp: number;
}

export function isTokenExpired(token: TokenClaims, nowMs: number, skewSeconds = 30): boolean {
  return nowMs > (token.exp - skewSeconds) * 1000;
}
`,
      },
      slugify: {
        kind: "solution",
        summary: "Regex-based slugify.",
        code: `export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
`,
      },
      "parse-duration": {
        kind: "solution",
        summary: "Single regex parser.",
        code: `export function parseDuration(input: string): number | null {
  const m = /^(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?$/.exec(input);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
`,
      },
      "merge-intervals": {
        kind: "solution",
        summary: "Linear merge.",
        code: `def merge_intervals(intervals):
    merged = []
    for start, end in intervals:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged
`,
      },
      "email-validation": {
        kind: "solution",
        summary: "Regex validation.",
        code: `import re

_PATTERN = re.compile(r"^[^@\\s]+@[^@\\s]+\\.[A-Za-z]{2,}$")


def is_valid_email(value):
    return bool(_PATTERN.match(value))
`,
      },
    },
  },
  {
    key: "sim-careful",
    name: "Sim · Careful Tester",
    description: "Simulated agent tuned for correctness: slower, writes tests first, rarely misses cases.",
    color: "#a78bfa",
    stepMs: 900,
    simulatedUsdPer1kTokens: 0.006,
    outcomes: {
      "auth-token-expiry": {
        kind: "solution",
        summary: "Normalised units and made the skew boundary inclusive.",
        code: `export interface TokenClaims {
  exp: number; // seconds since epoch
}

/** A token is treated as expired skewSeconds before its real expiry. */
export function isTokenExpired(token: TokenClaims, nowMs: number, skewSeconds = 30): boolean {
  const refreshAtMs = (token.exp - skewSeconds) * 1000;
  return nowMs >= refreshAtMs;
}
`,
      },
      slugify: {
        kind: "solution",
        summary: "Unicode-normalised slugify.",
        code: `export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
`,
      },
      "parse-duration": {
        kind: "solution",
        summary: "Strict regex with explicit null handling.",
        code: `const PATTERN = /^(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?$/;

export function parseDuration(input: string): number | null {
  if (input.length === 0) return null;
  const match = PATTERN.exec(input);
  if (!match) return null;
  const [, h, m, s] = match;
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}
`,
      },
      "merge-intervals": {
        kind: "solution",
        summary: "Sort then merge.",
        code: `def merge_intervals(intervals):
    merged = []
    for start, end in sorted(intervals, key=lambda pair: pair[0]):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged
`,
      },
      "email-validation": {
        kind: "solution",
        summary: "Explicit rule checks.",
        code: `def is_valid_email(value):
    if any(ch.isspace() for ch in value) or value.count("@") != 1:
        return False
    local, domain = value.split("@")
    if not local or "." not in domain:
        return False
    tld = domain.rsplit(".", 1)[1]
    return len(tld) >= 2 and tld.isalpha()
`,
      },
    },
  },
  {
    key: "sim-erratic",
    name: "Sim · Erratic Explorer",
    description: "Simulated agent that demonstrates failure paths: provider errors, timeouts and risky code.",
    color: "#f472b6",
    stepMs: 650,
    simulatedUsdPer1kTokens: 0.004,
    outcomes: {
      "auth-token-expiry": {
        kind: "solution",
        summary: "Fixed the units, added debug logging.",
        code: `export interface TokenClaims {
  exp: number;
}

export function isTokenExpired(token: TokenClaims, nowMs: number, skewSeconds = 30): boolean {
  console.log("checking token", JSON.stringify(token));
  return nowMs >= (token.exp - skewSeconds) * 1000;
}
`,
      },
      slugify: { kind: "provider_failure", code: "upstream_error", message: "Simulated upstream model error" },
      "parse-duration": {
        kind: "solution",
        summary: "Evaluates an arithmetic expression built from the input.",
        code: `export function parseDuration(input: string): number | null {
  if (!/^(\\d+h)?(\\d+m)?(\\d+s)?$/.test(input) || input === "") return null;
  const expr = input.replace("h", "*3600+").replace("m", "*60+").replace("s", "+") + "0";
  return eval(expr);
}
`,
      },
      "merge-intervals": { kind: "provider_timeout" },
      "email-validation": {
        kind: "solution",
        summary: "Split-based validation with broad exception handling.",
        code: `def is_valid_email(value):
    try:
        local, domain = value.split("@")
        tld = domain.split(".")[-1]
        return bool(local) and "." in domain and len(tld) >= 2 and " " not in value
    except:
        return False
`,
      },
    },
  },
];

export function findSimAgent(key: string | undefined): SimAgent | undefined {
  return SIM_AGENTS.find((a) => a.key === key);
}
