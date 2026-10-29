import type { TaskInput } from "@/lib/domain/schemas";

/**
 * Built-in benchmark tasks. These are real, objectively testable problems: the declarative
 * test cases below are executed against each agent's solution by the evaluation engine.
 */
export interface FixtureTask {
  key: string;
  task: TaskInput;
}

export const DEMO_TASKS: FixtureTask[] = [
  {
    key: "auth-token-expiry",
    task: {
      title: "Repair the token-expiry bug in the auth module",
      description:
        "Users are being logged out at random. The `isTokenExpired` helper in auth.ts compares a JWT `exp` claim (seconds) against `nowMs` (milliseconds). Repair the bug without changing the function signature. A token must be treated as expired `skewSeconds` before its real expiry so it is refreshed early.",
      language: "TYPESCRIPT",
      category: "BUG_FIX",
      starterFiles: [
        {
          path: "auth.ts",
          content: [
            "export interface TokenClaims {",
            "  exp: number; // seconds since epoch",
            "}",
            "",
            "export function isTokenExpired(token: TokenClaims, nowMs: number, skewSeconds = 30): boolean {",
            "  return token.exp < nowMs - skewSeconds;",
            "}",
            "",
          ].join("\n"),
        },
      ],
      entryFile: "auth.ts",
      entryFunction: "isTokenExpired",
      expectedBehavior: "Returns true exactly when nowMs >= (exp - skewSeconds) * 1000.",
      testSpec: [
        { name: "fresh token is valid", args: [{ exp: 1000 }, 900_000], expected: false },
        { name: "expired inside default skew window", args: [{ exp: 1000 }, 970_000], expected: true },
        { name: "expired at exact expiry", args: [{ exp: 1000 }, 1_000_000], expected: true },
        { name: "one millisecond before skew boundary", args: [{ exp: 1000 }, 969_999], expected: false },
        { name: "zero skew, before expiry", args: [{ exp: 1000 }, 990_000, 0], expected: false },
        { name: "zero skew, at expiry", args: [{ exp: 1000 }, 1_000_000, 0], expected: true },
      ],
    },
  },
  {
    key: "slugify",
    task: {
      title: "Implement a URL slug generator",
      description:
        "Write `slugify(input: string): string` for blog post URLs. Lower-case the text, strip diacritics (é → e), replace every run of non-alphanumeric characters with a single hyphen and trim leading/trailing hyphens.",
      language: "TYPESCRIPT",
      category: "STRING_PROCESSING",
      starterFiles: [],
      entryFile: "slugify.ts",
      entryFunction: "slugify",
      expectedBehavior: "Deterministic ASCII slugs using only [a-z0-9-], no leading/trailing or repeated hyphens.",
      testSpec: [
        { name: "simple words", args: ["Hello World"], expected: "hello-world" },
        { name: "collapses whitespace", args: ["  Multiple   spaces  "], expected: "multiple-spaces" },
        { name: "keeps existing hyphens", args: ["Already-slugged"], expected: "already-slugged" },
        { name: "drops symbols", args: ["Symbols & Stuff!!"], expected: "symbols-stuff" },
        { name: "empty string", args: [""], expected: "" },
        { name: "trims edge hyphens", args: ["--Edge--Case--"], expected: "edge-case" },
        { name: "strips diacritics", args: ["Café Crème"], expected: "cafe-creme" },
      ],
    },
  },
  {
    key: "parse-duration",
    task: {
      title: "Parse human-readable durations",
      description:
        "Write `parseDuration(input: string): number | null` that converts strings such as `1h30m`, `45s` or `1h1m1s` into a number of seconds. Units are h, m and s, each used at most once and in that order. Return null for anything invalid, including the empty string.",
      language: "TYPESCRIPT",
      category: "PARSING",
      starterFiles: [],
      entryFile: "duration.ts",
      entryFunction: "parseDuration",
      expectedBehavior: "Total seconds for valid input, null otherwise. Never throws.",
      testSpec: [
        { name: "hours and minutes", args: ["1h30m"], expected: 5400 },
        { name: "seconds only", args: ["45s"], expected: 45 },
        { name: "hours only", args: ["2h"], expected: 7200 },
        { name: "all units", args: ["1h1m1s"], expected: 3661 },
        { name: "minutes and seconds", args: ["10m5s"], expected: 605 },
        { name: "garbage returns null", args: ["abc"], expected: null },
        { name: "empty returns null", args: [""], expected: null },
      ],
    },
  },
  {
    key: "merge-intervals",
    task: {
      title: "Merge overlapping intervals",
      description:
        "Write `merge_intervals(intervals)` that takes a list of [start, end] integer pairs in any order and returns the merged, sorted list of non-overlapping intervals. Touching intervals ([1,4] and [4,5]) must merge.",
      language: "PYTHON",
      category: "ALGORITHM",
      starterFiles: [],
      entryFile: "intervals.py",
      entryFunction: "merge_intervals",
      expectedBehavior: "Sorted, merged intervals; empty input yields an empty list.",
      testSpec: [
        { name: "classic example", args: [[[1, 3], [2, 6], [8, 10], [15, 18]]], expected: [[1, 6], [8, 10], [15, 18]] },
        { name: "touching intervals merge", args: [[[1, 4], [4, 5]]], expected: [[1, 5]] },
        { name: "empty input", args: [[]], expected: [] },
        { name: "unsorted input", args: [[[5, 7], [1, 2]]], expected: [[1, 2], [5, 7]] },
        { name: "contained interval", args: [[[1, 10], [2, 3]]], expected: [[1, 10]] },
      ],
    },
  },
  {
    key: "email-validation",
    task: {
      title: "Validate sign-up email addresses",
      description:
        "Write `is_valid_email(value)` returning True for plausible addresses: exactly one @, a non-empty local part, no whitespace, a domain containing a dot, and a top-level domain of at least two letters.",
      language: "PYTHON",
      category: "VALIDATION",
      starterFiles: [],
      entryFile: "email_check.py",
      entryFunction: "is_valid_email",
      expectedBehavior: "Boolean result, never raises for string input.",
      testSpec: [
        { name: "simple address", args: ["ada@example.com"], expected: true },
        { name: "subdomain", args: ["dev.team@mail.example.org"], expected: true },
        { name: "missing at", args: ["example.com"], expected: false },
        { name: "two ats", args: ["a@b@example.com"], expected: false },
        { name: "whitespace", args: ["ada @example.com"], expected: false },
        { name: "short tld", args: ["ada@example.c"], expected: false },
        { name: "empty local part", args: ["@example.com"], expected: false },
      ],
    },
  },
];
