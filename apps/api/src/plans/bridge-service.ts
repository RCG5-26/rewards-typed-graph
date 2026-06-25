import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  PlanServiceError,
  type PlanService,
  type PlanServiceErrorCode,
} from "./service";
import {
  type BalanceTransferInput,
  type BalanceTransferResult,
  type PlanView,
  type SessionIdentity,
  type SessionView,
} from "./types";

const execFileAsync = promisify(execFile);

const BRIDGE_SCRIPT = fileURLToPath(
  new URL("../../bridge/hero_bridge.py", import.meta.url),
);
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const ERROR_CODES = new Set<PlanServiceErrorCode>([
  "validation",
  "not_found",
  "conflict",
]);

interface BridgeOptions {
  pythonBin?: string;
  cwd?: string;
  scriptPath?: string;
  env?: NodeJS.ProcessEnv;
}

type BridgeEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Production `PlanService`: each call spawns the Python hero bridge (one process
 * per request — fine for a demo), which talks to Postgres via the proven
 * `psql`-subprocess seam and returns a `{ ok, data | error }` JSON envelope on
 * stdout. This class only marshals args, parses the envelope, and re-raises
 * domain errors as `PlanServiceError` so the routes can map them to HTTP.
 */
export class BridgePlanService implements PlanService {
  private readonly pythonBin: string;
  private readonly cwd: string;
  private readonly scriptPath: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: BridgeOptions = {}) {
    this.pythonBin = options.pythonBin ?? process.env.PYTHON_BIN ?? "python3";
    this.cwd = options.cwd ?? REPO_ROOT;
    this.scriptPath = options.scriptPath ?? BRIDGE_SCRIPT;
    const baseEnv = options.env ?? process.env;
    this.env = {
      ...baseEnv,
      PYTHONPATH: [REPO_ROOT, baseEnv.PYTHONPATH].filter(Boolean).join(path.delimiter),
    };
  }

  async getSession(identity: SessionIdentity): Promise<SessionView> {
    const args: string[] = [];
    if (identity.userId) {
      args.push("--user-id", identity.userId);
    }
    if (identity.clerkId) {
      args.push("--clerk-id", identity.clerkId);
    }
    if (identity.email) {
      args.push("--email", identity.email);
    }
    return this.run<SessionView>("session", args);
  }

  async resetDemo(userId: string): Promise<SessionView> {
    return this.run<SessionView>("demo-reset", ["--user-id", userId]);
  }

  async createPlan(userId: string, query: string): Promise<PlanView> {
    return this.run<PlanView>("create-plan", [
      "--user-id",
      userId,
      "--query",
      query,
    ]);
  }

  async getPlanById(userId: string, planId: string): Promise<PlanView | null> {
    return this.run<PlanView | null>("get-plan", [
      "--user-id",
      userId,
      "--plan-id",
      planId,
    ]);
  }

  async getCurrentPlan(
    userId: string,
    lineageId: string,
  ): Promise<PlanView | null> {
    return this.run<PlanView | null>("current-plan", [
      "--user-id",
      userId,
      "--lineage-id",
      lineageId,
    ]);
  }

  async transferBalance(
    userId: string,
    input: BalanceTransferInput,
  ): Promise<BalanceTransferResult> {
    return this.run<BalanceTransferResult>("balance-transfer", [
      "--user-id",
      userId,
      "--source-program-id",
      input.sourceProgramId,
      "--dest-program-id",
      input.destProgramId,
      "--amount",
      String(input.amountPoints),
    ]);
  }

  private async run<T>(command: string, args: string[]): Promise<T> {
    const { stdout } = await execFileAsync(
      this.pythonBin,
      [this.scriptPath, command, ...args],
      { cwd: this.cwd, env: this.env, maxBuffer: 16 * 1024 * 1024 },
    ).catch((error: unknown) => {
      throw new Error(`hero bridge failed: ${describeSpawnError(error)}`);
    });

    const envelope = parseEnvelope<T>(stdout);
    if (envelope.ok) {
      return envelope.data;
    }

    const { code, message } = envelope.error;
    if (ERROR_CODES.has(code as PlanServiceErrorCode)) {
      throw new PlanServiceError(code as PlanServiceErrorCode, message);
    }
    throw new Error(`hero bridge error [${code}]: ${message}`);
  }
}

function parseEnvelope<T>(stdout: string): BridgeEnvelope<T> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("hero bridge returned no output");
  }
  // The bridge prints exactly one JSON envelope as its final line.
  const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
  try {
    return JSON.parse(lastLine) as BridgeEnvelope<T>;
  } catch {
    throw new Error(`hero bridge returned non-JSON output: ${trimmed}`);
  }
}

function describeSpawnError(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: string }).stderr;
    if (stderr && stderr.trim()) {
      return stderr.trim();
    }
  }
  return error instanceof Error ? error.message : String(error);
}
