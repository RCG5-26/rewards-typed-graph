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

/**
 * Kill the bridge child if it stalls (hung `python`/`psql`) so a single request
 * can't block an event-loop slot indefinitely. Generous for a demo.
 */
const BRIDGE_TIMEOUT_MS = 30_000;

/**
 * Only these vars cross the process boundary into the Python bridge. We do NOT
 * forward the full `process.env`, so non-DB secrets (e.g. `CLERK_SECRET_KEY`)
 * never reach the subprocess. The Postgres connection vars are included on
 * purpose: per spec 07 (Option B) the bridge IS the demo DB-access layer and
 * talks to Postgres via the proven `psql`-subprocess seam.
 */
const BRIDGE_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "PYTHON_BIN",
  "PYTHONPATH",
  "DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "PGSSLMODE",
] as const;

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

  /** Spawn the hero bridge with the configured Python binary and env whitelist. */
  constructor(options: BridgeOptions = {}) {
    this.pythonBin = options.pythonBin ?? process.env.PYTHON_BIN ?? "python3";
    this.cwd = options.cwd ?? REPO_ROOT;
    this.scriptPath = options.scriptPath ?? BRIDGE_SCRIPT;
    this.env = buildBridgeEnv(options.env ?? process.env);
  }

  /** Resolve or bootstrap the caller and return the session view model. */
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

  /** Reset demo state for the authenticated user via the bridge. */
  async resetDemo(userId: string): Promise<SessionView> {
    return this.run<SessionView>("demo-reset", ["--user-id", userId]);
  }

  /** Create revision 1 of a plan from a natural-language query. */
  async createPlan(userId: string, query: string): Promise<PlanView> {
    return this.run<PlanView>("create-plan", [
      "--user-id",
      userId,
      "--query",
      query,
    ]);
  }

  /** Fetch a single plan projection by id, or null when missing. */
  async getPlanById(userId: string, planId: string): Promise<PlanView | null> {
    return this.run<PlanView | null>("get-plan", [
      "--user-id",
      userId,
      "--plan-id",
      planId,
    ]);
  }

  /** Return the current revision for a plan lineage, if one exists. */
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

  /** Transfer points, stale the prior plan, and return the sync replan result. */
  async transferBalance(
    userId: string,
    input: BalanceTransferInput,
  ): Promise<BalanceTransferResult> {
    const args = [
      "--user-id",
      userId,
      "--source-program-id",
      input.sourceProgramId,
      "--dest-program-id",
      input.destProgramId,
      "--amount",
      String(input.amountPoints),
    ];
    if (input.idempotencyKey) {
      args.push("--idempotency-key", input.idempotencyKey);
    }
    return this.run<BalanceTransferResult>("balance-transfer", args);
  }

  /** Spawn hero_bridge.py for one subcommand and decode its JSON envelope. */
  private async run<T>(command: string, args: string[]): Promise<T> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        this.pythonBin,
        [this.scriptPath, command, ...args],
        {
          cwd: this.cwd,
          env: this.env,
          maxBuffer: 16 * 1024 * 1024,
          timeout: BRIDGE_TIMEOUT_MS,
          killSignal: "SIGKILL",
        },
      ));
    } catch (error: unknown) {
      // A non-zero exit still prints the JSON error envelope on stdout, so parse
      // that first — otherwise typed domain errors (404/409) degrade to a 500.
      const captured = readStdout(error);
      if (captured.trim()) {
        return this.fromEnvelope(parseEnvelope<T>(captured));
      }
      throw new Error(`hero bridge failed: ${describeSpawnError(error)}`);
    }

    return this.fromEnvelope(parseEnvelope<T>(stdout));
  }

  /** Turn a bridge envelope into data or a typed PlanServiceError. */
  private fromEnvelope<T>(envelope: BridgeEnvelope<T>): T {
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

/**
 * Whitelist the env handed to the Python subprocess (least privilege) and force
 * the repo root onto `PYTHONPATH` so `hero_flow` imports resolve.
 */
function buildBridgeEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of BRIDGE_ENV_ALLOWLIST) {
    if (source[key] !== undefined) {
      env[key] = source[key];
    }
  }
  env.PYTHONPATH = [REPO_ROOT, source.PYTHONPATH].filter(Boolean).join(path.delimiter);
  return env;
}

/** Read stdout from a failed execFile rejection when present. */
function readStdout(error: unknown): string {
  if (error && typeof error === "object" && "stdout" in error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    if (typeof stdout === "string") {
      return stdout;
    }
  }
  return "";
}

/** Parse the final JSON envelope line printed by the Python bridge. */
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

/** Summarize a subprocess spawn failure for operator-facing error messages. */
function describeSpawnError(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: string }).stderr;
    if (stderr && stderr.trim()) {
      return stderr.trim();
    }
  }
  return error instanceof Error ? error.message : String(error);
}
