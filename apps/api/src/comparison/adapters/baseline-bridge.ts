/**
 * Run a Python LLM baseline (single-agent or free-text crew) as a subprocess
 * and return the parsed report. Transport: argv-in / JSON-on-stdout, shell:false,
 * allow-listed env. Progress goes to the baselines' stderr; stdout is the clean
 * JSON report (one object), so the whole trimmed stdout is parsed.
 *
 * The baselines own their own LLM calls and read the canonical demo fixture; this
 * bridge is read-only and never persists anything.
 *
 * Interpreter policy (review Fix 1): the interpreter is taken from `PYTHON_BIN`
 * when set, otherwise the documented development default `python3.12`. The bare
 * `python3` is NOT used as a fallback — on machines where `python3` resolves to
 * an unsupported version (e.g. 3.14) a silent switch would change behavior. If
 * the chosen interpreter is unavailable the bridge fails with a clear, sanitized
 * error rather than degrading to another version.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** OS process boundary, injectable so tests can drive a tiny controlled script. */
export type ExecFileAsyncFn = typeof execFileAsync;

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/**
 * Documented development default interpreter (review Fix 1). The live baseline
 * path is verified on Python 3.12; `python3` on this machine resolves to 3.14,
 * so it is deliberately NOT a fallback.
 */
export const DEFAULT_PYTHON_BIN = "python3.12";

const BASELINE_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Bare fallback when a caller does not pass `timeoutMs`. Adapters always pass an
 * explicit per-variant bound (see `timeouts.ts`); this only guards direct callers.
 */
const DEFAULT_BASELINE_TIMEOUT_MS = 120_000;

// Baselines need their OpenAI credentials and may read model overrides, but get
// no database access — they are read-only for the comparison.
export const BASELINE_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "PYTHON_BIN",
  "PYTHONPATH",
  "OPENAI_API_KEY",
  "SINGLE_AGENT_BASELINE_API_KEY",
  "SINGLE_AGENT_BASELINE_MODEL",
  "FREE_TEXT_MULTIAGENT_BASELINE_API_KEY",
  "FREE_TEXT_MULTIAGENT_BASELINE_MODEL",
] as const;

export type BaselineModule =
  | "benchmark.single_agent_baseline"
  | "benchmark.free_text_multiagent_baseline";

export interface BaselineCaseResult {
  case_id?: string;
  token_cost_total?: number;
  status?: string;
  actual_top_award_slug?: string | null;
  baseline_plan_record?: {
    raw_output?: unknown;
  };
}

export interface BaselineReport {
  architecture?: string;
  fixture_id?: string;
  cases?: BaselineCaseResult[];
}

export interface BaselineBridgeOptions {
  pythonBin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fixturePath?: string;
  casesPath?: string;
  timeoutMs?: number;
  /** Injectable OS boundary for tests; defaults to the real `execFile`. */
  execFileImpl?: ExecFileAsyncFn;
}

/** Function shape adapters depend on, so tests can inject a fake report. */
export type RunBaselineReport = (
  module: BaselineModule,
  options?: BaselineBridgeOptions,
) => Promise<BaselineReport>;

/** Resolve the interpreter per the Fix 1 policy (PYTHON_BIN → python3.12). */
export function resolvePythonBin(options: BaselineBridgeOptions, source: NodeJS.ProcessEnv): string {
  return options.pythonBin ?? source.PYTHON_BIN ?? DEFAULT_PYTHON_BIN;
}

/** The exact argv the bridge marshals — module-in, JSON-on-stdout, limit one case. */
export function buildBaselineArgs(
  module: BaselineModule,
  fixturePath: string,
  casesPath: string,
): string[] {
  return ["-m", module, "--fixture", fixturePath, "--cases", casesPath, "--limit", "1"];
}

export const runBaselineReport: RunBaselineReport = async (module, options = {}) => {
  const source = options.env ?? process.env;
  const pythonBin = resolvePythonBin(options, source);
  const cwd = options.cwd ?? REPO_ROOT;
  const env = buildBaselineEnv(source);
  const fixturePath = options.fixturePath ?? "fixtures/demo-comparison-baseline.json";
  const casesPath = options.casesPath ?? "benchmark/gold/demo-comparison-cases.json";
  const timeoutMs = options.timeoutMs ?? DEFAULT_BASELINE_TIMEOUT_MS;
  const exec = options.execFileImpl ?? execFileAsync;
  const args = buildBaselineArgs(module, fixturePath, casesPath);

  let stdout: string;
  try {
    ({ stdout } = await exec(pythonBin, args, {
      cwd,
      env,
      maxBuffer: BASELINE_MAX_BUFFER,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      shell: false,
    }));
  } catch (error) {
    throw normalizeSubprocessError(error, { pythonBin, timeoutMs });
  }

  return parseReport(stdout);
};

interface SubprocessErrorContext {
  pythonBin: string;
  timeoutMs: number;
}

interface NodeExecError {
  code?: string | number | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stderr?: unknown;
}

/**
 * Map a raw `execFile` rejection to a clear, sanitized `Error` (review Fix 3/4).
 * Never leaks the child's full stderr or any secret-shaped token, and surfaces
 * the two operationally important cases — missing interpreter and timeout — as
 * distinct, actionable messages.
 */
export function normalizeSubprocessError(error: unknown, ctx: SubprocessErrorContext): Error {
  const e = (error ?? {}) as NodeExecError;
  if (e.code === "ENOENT") {
    return new Error(
      `python interpreter "${ctx.pythonBin}" is not available — set PYTHON_BIN to an installed Python 3.12 executable`,
    );
  }
  if (e.killed === true && (e.signal === "SIGKILL" || e.code === null || e.code === undefined)) {
    return new Error(`baseline subprocess timed out after ${ctx.timeoutMs}ms`);
  }
  const exit = typeof e.code === "number" ? e.code : "unknown";
  const detail = sanitizeStderr(typeof e.stderr === "string" ? e.stderr : undefined);
  return new Error(`baseline subprocess failed (exit ${exit})${detail ? `: ${detail}` : ""}`);
}

/** Redact secret-shaped tokens and bound length before surfacing child stderr. */
export function sanitizeStderr(stderr?: string): string {
  if (!stderr) return "";
  const redacted = stderr
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "[redacted-key]")
    .replace(/([A-Za-z_]*(?:API_KEY|SECRET|PASSWORD|TOKEN))\s*[=:]\s*\S+/gi, "$1=[redacted]");
  const collapsed = redacted.replace(/\s+/g, " ").trim();
  return collapsed.length > 300 ? `${collapsed.slice(0, 300)}…` : collapsed;
}

function parseReport(stdout: string): BaselineReport {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("baseline returned no output");
  try {
    return JSON.parse(trimmed) as BaselineReport;
  } catch {
    throw new Error(`baseline returned non-JSON output: ${trimmed.slice(0, 200)}`);
  }
}

export function firstCase(report: BaselineReport): BaselineCaseResult {
  const cases = report.cases ?? [];
  if (cases.length === 0) throw new Error("baseline report contained no cases");
  return cases[0];
}

export function buildBaselineEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of BASELINE_ENV_ALLOWLIST) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  env.PYTHONPATH = [REPO_ROOT, source.PYTHONPATH].filter(Boolean).join(path.delimiter);
  return env;
}
