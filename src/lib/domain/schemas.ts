import { z } from "zod";

/** Enum values mirrored from prisma/schema.prisma so validation works in the browser bundle too. */
export const LANGUAGES = ["TYPESCRIPT", "JAVASCRIPT", "PYTHON"] as const;
export const CATEGORIES = [
  "ALGORITHM",
  "BUG_FIX",
  "PARSING",
  "STRING_PROCESSING",
  "VALIDATION",
  "DATA_TRANSFORMATION",
  "OTHER",
] as const;
export const PROFILES = ["BALANCED", "CORRECTNESS", "SPEED", "COST"] as const;
export const RUN_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"] as const;

export type Language = (typeof LANGUAGES)[number];
export type Category = (typeof CATEGORIES)[number];
export type Profile = (typeof PROFILES)[number];
export type RunStatusValue = (typeof RUN_STATUSES)[number];

/** Relative POSIX path, no traversal, no absolute paths, conservative charset. */
export const safeRelativePath = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/, "Only letters, digits, _ . - / are allowed")
  .refine((p) => !p.split("/").some((seg) => seg === ".." || seg === "." || seg === ""), {
    message: "Path segments may not be empty, '.' or '..'",
  });

export const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Must be a valid identifier");

/** JSON values allowed in declarative test cases. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);

export const starterFileSchema = z.object({
  path: safeRelativePath,
  content: z.string().max(100_000),
});
export type StarterFile = z.infer<typeof starterFileSchema>;

export const testCaseSchema = z.object({
  name: z.string().min(1).max(120),
  args: z.array(jsonValue).max(10),
  expected: jsonValue,
});
export type TestCase = z.infer<typeof testCaseSchema>;

export const weightsSchema = z.object({
  correctness: z.number().min(0).max(1),
  reliability: z.number().min(0).max(1),
  quality: z.number().min(0).max(1),
  efficiency: z.number().min(0).max(1),
  security: z.number().min(0).max(1),
});
export type Weights = z.infer<typeof weightsSchema>;

export const constraintsSchema = z
  .object({
    maxSolutionBytes: z.number().int().min(100).max(200_000).optional(),
    forbidImports: z.array(z.string().max(60)).max(20).optional(),
  })
  .strict();

export const taskInputSchema = z
  .object({
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().min(10).max(8_000),
    language: z.enum(LANGUAGES),
    category: z.enum(CATEGORIES),
    starterFiles: z.array(starterFileSchema).max(10).default([]),
    entryFile: safeRelativePath,
    entryFunction: identifier,
    expectedBehavior: z.string().trim().min(3).max(4_000),
    testSpec: z.array(testCaseSchema).max(50).default([]),
    constraints: constraintsSchema.optional(),
  })
  .superRefine((t, ctx) => {
    const ext = t.entryFile.split(".").pop();
    const expected = { TYPESCRIPT: "ts", JAVASCRIPT: "js", PYTHON: "py" }[t.language];
    if (ext !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entryFile"],
        message: `Entry file for ${t.language} must end with .${expected}`,
      });
    }
  });
export type TaskInput = z.infer<typeof taskInputSchema>;

export const createBenchmarkSchema = z
  .object({
    task: taskInputSchema.optional(),
    taskId: z.string().cuid().optional(),
    agentIds: z.array(z.string().cuid()).min(2, "Select at least two agents").max(6),
    profile: z.enum(PROFILES).default("BALANCED"),
    weights: weightsSchema.optional(),
    timeoutSeconds: z.number().int().min(10).max(7_200).default(600),
    maxConcurrency: z.number().int().min(1).max(6).default(2),
    maxCostUsd: z.number().positive().max(50).optional(),
    /** Required true for LIVE executions — the explicit per-benchmark spend confirmation. */
    confirmLiveSpend: z.boolean().default(false),
  })
  .refine((b) => Boolean(b.task) !== Boolean(b.taskId), {
    message: "Provide exactly one of task or taskId",
    path: ["task"],
  })
  .refine((b) => new Set(b.agentIds).size === b.agentIds.length, {
    message: "Agents must be distinct",
    path: ["agentIds"],
  });
export type CreateBenchmarkInput = z.infer<typeof createBenchmarkSchema>;

export const routeQuerySchema = z.object({
  description: z.string().trim().min(5).max(4_000),
  objective: z.enum(PROFILES).default("BALANCED"),
  language: z.enum(LANGUAGES).optional(),
  category: z.enum(CATEGORIES).optional(),
});
export type RouteQuery = z.infer<typeof routeQuerySchema>;

export const agentConfigInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  harnessId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.:-]+$/, "Unexpected characters in harness id"),
  base: z.string().trim().max(64).optional(),
  model: z.string().trim().max(128).optional(),
  languages: z.array(z.enum(LANGUAGES)).min(1),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type AgentConfigInput = z.infer<typeof agentConfigInputSchema>;
