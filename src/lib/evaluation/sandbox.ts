import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JS_RUNNER, PY_RUNNER } from "./runners";

/**
 * Isolated execution of untrusted generated code.
 *
 * Each evaluation runs in a throw-away Docker container with:
 *   --network none, read-only root FS, read-only bind mount of the work dir,
 *   non-root user (nobody), all capabilities dropped, no-new-privileges,
 *   memory / CPU / PID limits, a small noexec tmpfs, and a hard wall-clock kill.
 * Commands are passed as argv arrays (execFile, never a shell) and contain no
 * user-controlled strings other than files written to the mounted directory.
 *
 * Residual risk: containers share the host kernel; a kernel or Docker escape
 * vulnerability would break isolation. See docs/SECURITY.md.
 */
export interface SandboxRunInput {
  language: "TYPESCRIPT" | "JAVASCRIPT" | "PYTHON";
  /** JS (already transpiled) or Python source. */
  source: string;
  entryFunction: string;
  /** Only test arguments are sent into the sandbox — expected values never are. */
  argsList: unknown[][];
}

export type SandboxCaseResult = { ok: true; value: unknown } | { ok: false; error: string };

export interface SandboxRunOutput {
  status: "ok" | "load_error" | "timeout" | "crashed" | "unavailable";
  results: SandboxCaseResult[];
  loadError?: string;
  durationMs: number;
  stderrTail?: string;
  limits: Record<string, string | number>;
  image?: string;
}

export interface Sandbox {
  isAvailable(language: SandboxRunInput["language"]): Promise<{ available: boolean; reason?: string }>;
  run(input: SandboxRunInput): Promise<SandboxRunOutput>;
}

export interface DockerSandboxOptions {
  nodeImage: string;
  pythonImage: string;
  timeoutMs: number;
}

const LIMITS = { memory: "256m", cpus: "0.5", pidsLimit: 64, tmpfs: "16m" } as const;
const MAX_OUTPUT_BYTES = 1_000_000;

export class DockerSandbox implements Sandbox {
  constructor(private readonly opts: DockerSandboxOptions) {}

  private image(language: SandboxRunInput["language"]) {
    return language === "PYTHON" ? this.opts.pythonImage : this.opts.nodeImage;
  }

  async isAvailable(language: SandboxRunInput["language"]) {
    const image = this.image(language);
    const res = await execFileResult("docker", ["image", "inspect", "--format", "{{.Id}}", image], 10_000);
    if (res.code === 0) return { available: true };
    if (res.spawnError) return { available: false, reason: "Docker CLI not found" };
    return { available: false, reason: `Sandbox image ${image} is not present (run: npm run sandbox:pull)` };
  }

  async run(input: SandboxRunInput): Promise<SandboxRunOutput> {
    const started = Date.now();
    const image = this.image(input.language);
    const nonce = randomUUID().replace(/-/g, "");
    const dir = await mkdtemp(join(tmpdir(), "agentarena-eval-"));
    const name = `agentarena-eval-${nonce.slice(0, 12)}`;
    const limits = { ...LIMITS, network: "none", user: "65534:65534", timeoutMs: this.opts.timeoutMs };
    try {
      const isPy = input.language === "PYTHON";
      await writeFile(join(dir, isPy ? "solution.py" : "solution.mjs"), input.source, "utf8");
      await writeFile(join(dir, isPy ? "runner.py" : "runner.mjs"), isPy ? PY_RUNNER : JS_RUNNER, "utf8");
      await writeFile(join(dir, "cases.json"), JSON.stringify({ fn: input.entryFunction, cases: input.argsList }), "utf8");

      const args = [
        "run",
        "--rm",
        "--name", name,
        "--pull", "never",
        "--network", "none",
        "--read-only",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--user", limits.user,
        "--memory", LIMITS.memory,
        "--memory-swap", LIMITS.memory,
        "--cpus", LIMITS.cpus,
        "--pids-limit", String(LIMITS.pidsLimit),
        "--tmpfs", `/tmp:rw,noexec,nosuid,size=${LIMITS.tmpfs}`,
        "--mount", `type=bind,source=${dir},target=/work,readonly`,
        "--workdir", "/work",
        "--env", "PYTHONDONTWRITEBYTECODE=1",
        "--env", `AA_NONCE=${nonce}`,
        image,
        ...(isPy ? ["python", "-I", "/work/runner.py"] : ["node", "/work/runner.mjs"]),
      ];

      const res = await execFileResult("docker", args, this.opts.timeoutMs);
      const durationMs = Date.now() - started;
      if (res.timedOut) {
        await execFileResult("docker", ["kill", name], 10_000);
        return { status: "timeout", results: [], durationMs, limits, image };
      }
      const parsed = parseRunnerOutput(res.stdout, nonce);
      if (!parsed) {
        return { status: "crashed", results: [], durationMs, stderrTail: res.stderr.slice(-800), limits, image };
      }
      if (parsed.loadError) return { status: "load_error", results: [], loadError: parsed.loadError.slice(0, 800), durationMs, limits, image };
      return { status: "ok", results: parsed.results.slice(0, input.argsList.length), durationMs, limits, image };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Sandbox used when isolation is unavailable or disabled: runtime tests are reported as unavailable. */
export class DisabledSandbox implements Sandbox {
  constructor(private readonly reason = "Runtime sandbox disabled (SANDBOX_MODE=disabled)") {}
  async isAvailable() {
    return { available: false, reason: this.reason };
  }
  async run(): Promise<SandboxRunOutput> {
    return { status: "unavailable", results: [], durationMs: 0, limits: {} };
  }
}

/**
 * Runner output is framed by a per-run nonce passed via env. The *last* framed line wins.
 * Even a forged frame cannot fake a pass: expected values never enter the sandbox,
 * and comparison happens on the host.
 */
export function parseRunnerOutput(stdout: string, nonce: string): { results: SandboxCaseResult[]; loadError?: string } | undefined {
  const marker = `__AA_RESULT_${nonce}__`;
  const idx = stdout.lastIndexOf(marker);
  if (idx === -1) return undefined;
  const line = stdout.slice(idx + marker.length).split("\n")[0] ?? "";
  try {
    const value = JSON.parse(line) as { results?: unknown; loadError?: unknown };
    const results = Array.isArray(value.results)
      ? value.results.map((r): SandboxCaseResult => {
          const rec = r as { ok?: unknown; value?: unknown; error?: unknown };
          return rec.ok === true ? { ok: true, value: rec.value } : { ok: false, error: String(rec.error ?? "error").slice(0, 300) };
        })
      : [];
    return { results, loadError: typeof value.loadError === "string" ? value.loadError : undefined };
  } catch {
    return undefined;
  }
}

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: boolean;
}

function execFileResult(cmd: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, shell: false }, (error, stdout, stderr) => {
      const err = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      resolve({
        code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        stdout: String(stdout),
        stderr: String(stderr),
        timedOut: Boolean(err?.killed),
        spawnError: err?.code === "ENOENT",
      });
    });
  });
}
