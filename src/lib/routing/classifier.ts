import type { Category, Language } from "@/lib/domain/schemas";

/**
 * Deterministic keyword classifier for task descriptions. Transparent by design:
 * every decision lists the keywords that triggered it. No ML, no model calls.
 */
const LANGUAGE_SIGNALS: Array<[Language, RegExp]> = [
  ["PYTHON", /\b(python|py|django|flask|fastapi|pandas|numpy|pytest|\.py)\b/i],
  ["TYPESCRIPT", /\b(typescript|ts|tsx|next\.?js|angular|deno|\.ts)\b/i],
  ["JAVASCRIPT", /\b(javascript|js|node\.?js|react|express|\.js)\b/i],
];

const CATEGORY_SIGNALS: Array<[Category, RegExp]> = [
  ["BUG_FIX", /\b(bug|fix|repair|broken|regression|failing|crash|error|issue)\b/i],
  ["PARSING", /\b(parse|parser|parsing|tokeni[sz]e|lexer|grammar|duration|deserialize)\b/i],
  ["VALIDATION", /\b(validat\w*|sanitize|verify|check (if|whether)|is[_ ]valid|email|schema)\b/i],
  ["STRING_PROCESSING", /\b(string|slug|text|format|case|whitespace|unicode|regex)\b/i],
  ["ALGORITHM", /\b(algorithm|sort|search|graph|interval|dynamic programming|tree|optimi[sz]e|complexity)\b/i],
  ["DATA_TRANSFORMATION", /\b(transform|map|convert|aggregate|group by|csv|json|etl|normali[sz]e)\b/i],
];

export interface Classification {
  language?: Language;
  category?: Category;
  signals: string[];
}

export function classifyTask(description: string): Classification {
  const signals: string[] = [];
  let language: Language | undefined;
  for (const [lang, re] of LANGUAGE_SIGNALS) {
    const m = re.exec(description);
    if (m) {
      language = lang;
      signals.push(`language "${m[0]}" → ${lang}`);
      break;
    }
  }
  let best: { cat: Category; hits: string[] } | undefined;
  for (const [cat, re] of CATEGORY_SIGNALS) {
    const hits = [...description.matchAll(new RegExp(re.source, "gi"))].map((m) => m[0].toLowerCase());
    if (hits.length && (!best || hits.length > best.hits.length)) best = { cat, hits };
  }
  if (best) signals.push(`category keywords [${[...new Set(best.hits)].join(", ")}] → ${best.cat}`);
  return { language, category: best?.cat, signals };
}
