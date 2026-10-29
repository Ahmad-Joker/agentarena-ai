import { createHash } from "node:crypto";
import type { TaskInput } from "@/lib/domain/schemas";

const LANGUAGE_LABEL = { TYPESCRIPT: "TypeScript", JAVASCRIPT: "JavaScript", PYTHON: "Python" } as const;

/**
 * Builds the single prompt every agent in a benchmark receives (fairness requirement).
 * The prompt is stored on the Benchmark row so it can be audited later.
 * Test expectations are described, not leaked verbatim, so agents cannot hard-code answers.
 */
export function buildBenchmarkPrompt(task: TaskInput): string {
  const lang = LANGUAGE_LABEL[task.language];
  const exportHint =
    task.language === "PYTHON"
      ? `define a top-level function \`${task.entryFunction}\``
      : `export a function named \`${task.entryFunction}\` (ES module named export)`;
  const files = task.starterFiles.length
    ? `Starting files are attached: ${task.starterFiles.map((f) => f.path).join(", ")}.`
    : "There are no starting files.";

  return [
    `# Task: ${task.title}`,
    "",
    task.description,
    "",
    `## Requirements`,
    `- Language: ${lang}.`,
    `- Write your solution to the file \`${task.entryFile}\` and ${exportHint}.`,
    `- Expected behaviour: ${task.expectedBehavior}`,
    `- Use only the standard library. No network access is available during evaluation.`,
    `- ${files}`,
    "",
    "## Output",
    `When finished, reply with the complete final contents of \`${task.entryFile}\` in a single fenced code block.`,
  ].join("\n");
}

/** Stable hash of the normalized task definition (reproducibility + fixture lookup). */
export function hashTask(task: TaskInput): string {
  const normalized = {
    title: task.title,
    description: task.description,
    language: task.language,
    category: task.category,
    starterFiles: [...task.starterFiles].sort((a, b) => a.path.localeCompare(b.path)),
    entryFile: task.entryFile,
    entryFunction: task.entryFunction,
    expectedBehavior: task.expectedBehavior,
    testSpec: task.testSpec,
    constraints: task.constraints ?? null,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

const FENCE_LANGS: Record<string, string[]> = {
  TYPESCRIPT: ["ts", "typescript", "tsx"],
  JAVASCRIPT: ["js", "javascript", "mjs"],
  PYTHON: ["py", "python", "python3"],
};

/**
 * Fallback artifact extraction from the agent's final message when the provider
 * did not return the file. Picks the last fenced block in the task's language,
 * or the last untagged block.
 */
export function extractCodeBlock(text: string, language: string): string | undefined {
  const fence = /```([A-Za-z0-9_+-]*)[^\n]*\n([\s\S]*?)```/g;
  const accepted = FENCE_LANGS[language] ?? [];
  let tagged: string | undefined;
  let untagged: string | undefined;
  for (const m of text.matchAll(fence)) {
    const tag = (m[1] ?? "").toLowerCase();
    const body = m[2] ?? "";
    if (accepted.includes(tag)) tagged = body;
    else if (!tag) untagged = body;
  }
  return tagged ?? untagged;
}
