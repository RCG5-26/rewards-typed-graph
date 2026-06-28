/**
 * Run a Python LLM baseline (single-agent or free-text crew) as a subprocess
 * and return the parsed report. Transport: argv-in / JSON-on-stdout, shell:false,
 * allow-listed env. Progress goes to the baselines' stderr; stdout is the clean
 * JSON report (one object), so the whole trimmed stdout is parsed.
 *
 * The baselines own their own LLM calls and read the canonical demo fixture; this
 * bridge is read-only and never persists anything.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

const BASELINE_TIMEOUT_MS = 120_000;
const BASELINE_MAX_BUFFER = 16 * 1024 * 1024;

// Baselines need their OpenAI credentials and may read model overrides, but get
// no database access — they are read-only for the comparison.
const BASELINE_ENV_ALLOWLIST = [
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
}

/** Function shape adapters depend on, so tests can inject a fake report. */
export type RunBaselineReport = (
  module: BaselineModule,
  options?: BaselineBridgeOptions,
) => Promise<BaselineReport>;

export const runBaselineReport: RunBaselineReport = async (module, options = {}) => {
  const pythonBin = options.pythonBin ?? process.env.PYTHON_BIN ?? "python3";
  const cwd = options.cwd ?? REPO_ROOT;
  const env = buildBaselineEnv(options.env ?? process.env);
  const fixturePath = options.fixturePath ?? "fixtures/demo-comparison-baseline.json";
  const casesPath = options.casesPath ?? "benchmark/gold/demo-comparison-cases.json";

  const { stdout } = await execFileAsync(
    pythonBin,
    ["-m", module, "--fixture", fixturePath, "--cases", casesPath, "--limit", "1"],
    {
      cwd,
      env,
      maxBuffer: BASELINE_MAX_BUFFER,
      timeout: options.timeoutMs ?? BASELINE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      shell: false,
    },
  );

  return parseReport(stdout);
};

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

function buildBaselineEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of BASELINE_ENV_ALLOWLIST) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  env.PYTHONPATH = [REPO_ROOT, source.PYTHONPATH].filter(Boolean).join(path.delimiter);
  return env;
}
