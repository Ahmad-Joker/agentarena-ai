import "server-only";
import { z } from "zod";

const boolString = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  AGENTARENA_MODE: z.enum(["DEMO", "LIVE"]).default("DEMO"),
  ALLOW_LIVE_EXECUTION: boolString,
  HR_BASE_URL: z.string().url().default("https://api.harnessrouter.ai"),
  HR_API_KEY: z.string().optional(),
  SANDBOX_MODE: z.enum(["docker", "disabled"]).default("docker"),
  SANDBOX_NODE_IMAGE: z.string().default("node:22-alpine"),
  SANDBOX_PYTHON_IMAGE: z.string().default("python:3.12-alpine"),
  SANDBOX_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).max(10).default(2),
  DEFAULT_RUN_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(7_200).default(600),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

/** Validated server environment. Throws a descriptive error (without values) when misconfigured. */
export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server configuration; check these variables: ${fields}`);
  }
  cached = { ...parsed.data, HR_API_KEY: parsed.data.HR_API_KEY?.trim() || undefined };
  return cached;
}

/** Browser-safe summary of the environment. Never includes secrets. */
export function getPublicEnvStatus() {
  const env = getEnv();
  return {
    mode: env.AGENTARENA_MODE,
    liveExecutionAllowed: env.AGENTARENA_MODE === "LIVE" && env.ALLOW_LIVE_EXECUTION && Boolean(env.HR_API_KEY),
    harnessRouterKeyConfigured: Boolean(env.HR_API_KEY),
    harnessRouterBaseUrl: env.HR_BASE_URL,
    sandboxMode: env.SANDBOX_MODE,
    maxConcurrentRuns: env.MAX_CONCURRENT_RUNS,
    defaultRunTimeoutSeconds: env.DEFAULT_RUN_TIMEOUT_SECONDS,
  };
}
