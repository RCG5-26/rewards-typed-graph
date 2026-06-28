/**
 * Direct tests for the production baseline subprocess wrapper (review Fix 3).
 *
 * The adapter tests inject a fake `runReport`, so the real subprocess seam —
 * interpreter selection, argv/module marshalling, env allow-list, JSON parsing,
 * exit/timeout/missing-binary handling, and stderr sanitization — is otherwise
 * untested. These exercise the REAL `execFile` boundary against a tiny controlled
 * node script (`tests/helpers/fake-baseline.mjs`), never OpenAI.
 *
 * Two seam-driving styles, both hitting the production code path:
 *  - real spawn: the injected `execFileImpl` re-dispatches to the genuine
 *    `execFile` running the fake script, while capturing the (bin, args, opts)
 *    the wrapper built — real process behavior + construction assertions.
 *  - capture-only: returns canned stdout to assert interpreter/argv/options
 *    without spawning, for fast deterministic construction checks.
 */

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PYTHON_BIN,
  type ExecFileAsyncFn,
  buildBaselineArgs,
  buildBaselineEnv,
  resolvePythonBin,
  runBaselineReport,
  sanitizeStderr,
} from "./baseline-bridge";

const execFileReal = promisify(execFile);

const FAKE_BASELINE = fileURLToPath(
  new URL("../../../tests/helpers/fake-baseline.mjs", import.meta.url),
);

const MODULE = "benchmark.single_agent_baseline";
const GINZA = "award:demo_hyatt_ginza:tokyo:3n";

// Cold node spawns under full-suite parallel load can exceed vitest's 5s default.
const SUBPROCESS_TIMEOUT_MS = 30_000;

// Obviously-fake credentials so the secret scan never trips on this file.
const FAKE_OPENAI = "test-openai-key-not-real";
const FAKE_CLERK = "test-clerk-secret-not-real";
const FAKE_DB = "postgres://test/not-real";

interface Capture {
  bin?: string;
  args?: readonly string[];
  opts?: Record<string, unknown>;
}

function validReport(): string {
  return JSON.stringify({
    architecture: "fake_baseline",
    cases: [{ token_cost_total: 1234, actual_top_award_slug: GINZA }],
  });
}

/** Inject the REAL execFile running the fake script under `mode`, capturing the wrapper's call. */
function realSpawn(mode: string, capture: Capture): ExecFileAsyncFn {
  return (async (bin: string, args: readonly string[], opts: Record<string, unknown>) => {
    capture.bin = bin;
    capture.args = args;
    capture.opts = opts;
    return execFileReal(process.execPath, [FAKE_BASELINE, mode], {
      env: opts.env as NodeJS.ProcessEnv,
      timeout: opts.timeout as number,
      killSignal: opts.killSignal as NodeJS.Signals,
      maxBuffer: opts.maxBuffer as number,
      shell: false,
    });
  }) as unknown as ExecFileAsyncFn;
}

/** Capture the wrapper's call and return canned stdout without spawning. */
function captureOnly(capture: Capture): ExecFileAsyncFn {
  return (async (bin: string, args: readonly string[], opts: Record<string, unknown>) => {
    capture.bin = bin;
    capture.args = args;
    capture.opts = opts;
    return { stdout: validReport(), stderr: "" };
  }) as unknown as ExecFileAsyncFn;
}

describe("baseline-bridge subprocess seam", () => {
  it("parses valid JSON stdout into a report", async () => {
    const report = await runBaselineReport(MODULE, {
      execFileImpl: realSpawn("valid", {}),
      env: { PATH: process.env.PATH },
    });
    expect(report.cases?.[0]?.actual_top_award_slug).toBe(GINZA);
  }, SUBPROCESS_TIMEOUT_MS);

  it("rejects malformed JSON stdout", async () => {
    await expect(
      runBaselineReport(MODULE, { execFileImpl: realSpawn("malformed", {}), env: { PATH: process.env.PATH } }),
    ).rejects.toThrow(/non-JSON/);
  }, SUBPROCESS_TIMEOUT_MS);

  it("rejects empty stdout", async () => {
    await expect(
      runBaselineReport(MODULE, { execFileImpl: realSpawn("empty", {}), env: { PATH: process.env.PATH } }),
    ).rejects.toThrow(/no output/);
  }, SUBPROCESS_TIMEOUT_MS);

  it("surfaces a nonzero exit code as a sanitized failure", async () => {
    await expect(
      runBaselineReport(MODULE, { execFileImpl: realSpawn("exit", {}), env: { PATH: process.env.PATH } }),
    ).rejects.toThrow(/exit 3/);
  }, SUBPROCESS_TIMEOUT_MS);

  it("sanitizes secret-shaped tokens out of stderr", async () => {
    const error = await runBaselineReport(MODULE, {
      execFileImpl: realSpawn("stderr-secret", {}),
      env: { PATH: process.env.PATH },
    }).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).not.toMatch(/sk-ABCD1234EFGH5678/);
    expect(message).not.toMatch(/supersecretvalue/);
    expect(message).toMatch(/redacted/);
  }, SUBPROCESS_TIMEOUT_MS);

  it("kills and reports a timeout when the subprocess overruns its bound", async () => {
    await expect(
      runBaselineReport(MODULE, {
        execFileImpl: realSpawn("sleep", {}),
        timeoutMs: 300,
        env: { PATH: process.env.PATH },
      }),
    ).rejects.toThrow(/timed out after 300ms/);
  }, SUBPROCESS_TIMEOUT_MS);

  it("fails clearly when the python interpreter is missing", async () => {
    await expect(
      runBaselineReport(MODULE, {
        pythonBin: "definitely-not-a-real-binary-xyz",
        env: { PATH: process.env.PATH },
      }),
    ).rejects.toThrow(/not available/);
  }, SUBPROCESS_TIMEOUT_MS);

  it("forwards only allow-listed env to the subprocess", async () => {
    const report = (await runBaselineReport(MODULE, {
      execFileImpl: realSpawn("env", {}),
      env: {
        PATH: process.env.PATH,
        OPENAI_API_KEY: FAKE_OPENAI,
        DATABASE_URL: FAKE_DB,
        CLERK_SECRET_KEY: FAKE_CLERK,
        PGHOST: "localhost",
      },
    })) as unknown as { observedEnv: Record<string, string> };
    const observed = report.observedEnv;
    expect(observed.OPENAI_API_KEY).toBe(FAKE_OPENAI);
    expect(typeof observed.PYTHONPATH).toBe("string");
    // PGHOST is not on the allow-list — the baselines get no DB access.
    expect(observed.PGHOST).toBeUndefined();
  }, SUBPROCESS_TIMEOUT_MS);

  it("never forwards secrets the baselines do not need (DATABASE_URL, CLERK_SECRET_KEY)", async () => {
    const report = (await runBaselineReport(MODULE, {
      execFileImpl: realSpawn("env", {}),
      env: {
        PATH: process.env.PATH,
        OPENAI_API_KEY: FAKE_OPENAI,
        DATABASE_URL: FAKE_DB,
        CLERK_SECRET_KEY: FAKE_CLERK,
      },
    })) as unknown as { observedEnv: Record<string, string> };
    expect(report.observedEnv.DATABASE_URL).toBeUndefined();
    expect(report.observedEnv.CLERK_SECRET_KEY).toBeUndefined();
  }, SUBPROCESS_TIMEOUT_MS);

  it("spawns with shell:false (no shell interpolation of argv)", async () => {
    const capture: Capture = {};
    await runBaselineReport(MODULE, { execFileImpl: captureOnly(capture), env: {} });
    expect(capture.opts?.shell).toBe(false);
  });

  it("marshals the expected module and argv", async () => {
    const capture: Capture = {};
    await runBaselineReport(MODULE, {
      execFileImpl: captureOnly(capture),
      env: {},
      fixturePath: "fixtures/demo-comparison-baseline.json",
      casesPath: "benchmark/gold/demo-comparison-cases.json",
    });
    expect(capture.args).toEqual(
      buildBaselineArgs(
        MODULE,
        "fixtures/demo-comparison-baseline.json",
        "benchmark/gold/demo-comparison-cases.json",
      ),
    );
    expect(capture.args).toEqual([
      "-m",
      MODULE,
      "--fixture",
      "fixtures/demo-comparison-baseline.json",
      "--cases",
      "benchmark/gold/demo-comparison-cases.json",
      "--limit",
      "1",
    ]);
  });
});

describe("baseline interpreter policy (Fix 1)", () => {
  it("defaults to python3.12 and never silently uses python3", async () => {
    const capture: Capture = {};
    await runBaselineReport(MODULE, { execFileImpl: captureOnly(capture), env: {} });
    expect(capture.bin).toBe(DEFAULT_PYTHON_BIN);
    expect(capture.bin).toBe("python3.12");
    expect(capture.bin).not.toBe("python3");
  });

  it("prefers an explicit PYTHON_BIN from the environment", async () => {
    const capture: Capture = {};
    await runBaselineReport(MODULE, {
      execFileImpl: captureOnly(capture),
      env: { PYTHON_BIN: "/opt/python3.12/bin/python3.12" },
    });
    expect(capture.bin).toBe("/opt/python3.12/bin/python3.12");
  });

  it("prefers an explicit pythonBin option over the environment", async () => {
    const capture: Capture = {};
    await runBaselineReport(MODULE, {
      execFileImpl: captureOnly(capture),
      pythonBin: "python3.12-explicit",
      env: { PYTHON_BIN: "should-be-ignored" },
    });
    expect(capture.bin).toBe("python3.12-explicit");
  });

  it("resolvePythonBin: option > PYTHON_BIN > python3.12", () => {
    expect(resolvePythonBin({}, {})).toBe("python3.12");
    expect(resolvePythonBin({}, { PYTHON_BIN: "python3.12-env" })).toBe("python3.12-env");
    expect(resolvePythonBin({ pythonBin: "opt" }, { PYTHON_BIN: "env" })).toBe("opt");
  });
});

describe("sanitizeStderr", () => {
  it("redacts sk- keys and KEY=value pairs and bounds length", () => {
    expect(sanitizeStderr("sk-ABCDEF123456")).toBe("[redacted-key]");
    expect(sanitizeStderr("OPENAI_API_KEY=foobar")).toBe("OPENAI_API_KEY=[redacted]");
    expect(sanitizeStderr("")).toBe("");
    const long = "x".repeat(500);
    expect(sanitizeStderr(long).length).toBeLessThanOrEqual(301);
  });

  it("env allow-list helper drops non-listed keys and always sets PYTHONPATH", () => {
    const env = buildBaselineEnv({ OPENAI_API_KEY: FAKE_OPENAI, DATABASE_URL: FAKE_DB });
    expect(env.OPENAI_API_KEY).toBe(FAKE_OPENAI);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(typeof env.PYTHONPATH).toBe("string");
  });
});
