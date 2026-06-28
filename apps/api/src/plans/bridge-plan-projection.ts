import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { PlanProjectionPort } from "../orchestrator/contracts";
import type { PlanView } from "./types";

const execFileAsync = promisify(execFile);

const BRIDGE_SCRIPT = fileURLToPath(new URL("../../bridge/hero_bridge.py", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Kill a stalled bridge child so one projection read can't pin an event-loop slot. */
const BRIDGE_TIMEOUT_MS = 30_000;
/** Bound the projected output so a runaway read can't exhaust memory. */
const BRIDGE_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Only these vars cross into the Python bridge. The full `process.env` is NOT
 * forwarded, so non-DB secrets (notably `CLERK_SECRET_KEY`) never reach the
 * subprocess. The Postgres connection vars are intentional: per spec 07 the
 * bridge is the demo DB-access layer (psql-subprocess seam).
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

type BridgeEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface BridgePlanProjectionOptions {
  pythonBin?: string;
  cwd?: string;
  scriptPath?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Internal failure for the projection read. Distinct from `PlanServiceError`
 * (4xx domain errors): a bridge protocol failure, a non-JSON response, a
 * structured bridge error, or a malformed `PlanView` are all 500-class
 * internal errors. A missing plan is NOT an error — it returns `null` so the
 * caller can map it to 404.
 */
export class PlanProjectionError extends Error {
  constructor(
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "PlanProjectionError";
  }
}

/**
 * Contract 7 — production `PlanProjectionPort` over the additive `read-plan`
 * bridge subcommand (which delegates to the existing Python `project_plan`).
 *
 * Guarantees:
 *  - User-scoped: `userId` is always forwarded; a user can never read another
 *    user's plan.
 *  - Read-only: only the `read-plan` subcommand is invoked — no plan
 *    generation, no replanning, no legacy-engine fallback.
 *  - Bounded + interruptible: `shell: false`, allow-listed env, finite timeout,
 *    bounded stdout buffer.
 *  - Runtime-validated: the bridge envelope AND the projected `PlanView` shape
 *    are validated before the value is returned.
 *  - Explicit outcomes: a projection miss returns `null`; protocol/internal
 *    failures throw {@link PlanProjectionError}.
 */
export class BridgePlanProjection implements PlanProjectionPort {
  private readonly pythonBin: string;
  private readonly cwd: string;
  private readonly scriptPath: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: BridgePlanProjectionOptions = {}) {
    this.pythonBin = options.pythonBin ?? process.env.PYTHON_BIN ?? "python3";
    this.cwd = options.cwd ?? REPO_ROOT;
    this.scriptPath = options.scriptPath ?? BRIDGE_SCRIPT;
    this.env = buildBridgeEnv(options.env ?? process.env);
  }

  async project(planId: string, userId: string): Promise<PlanView | null> {
    const data = await this.readPlan(userId, planId);
    if (data === null || data === undefined) {
      return null;
    }
    return assertValidPlanView(data, planId);
  }

  /** Spawn `hero_bridge.py read-plan` for one plan and decode its JSON envelope. */
  private async readPlan(userId: string, planId: string): Promise<unknown> {
    const args = [this.scriptPath, "read-plan", "--user-id", userId, "--plan-id", planId];

    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(this.pythonBin, args, {
        cwd: this.cwd,
        env: this.env,
        maxBuffer: BRIDGE_MAX_BUFFER,
        timeout: BRIDGE_TIMEOUT_MS,
        killSignal: "SIGKILL",
        shell: false,
      }));
    } catch (error: unknown) {
      // A non-zero exit still prints the JSON error envelope on stdout, so parse
      // that first — otherwise a typed bridge error degrades into a spawn error.
      const captured = readStdout(error);
      if (captured.trim()) {
        return this.fromEnvelope(parseEnvelope<unknown>(captured));
      }
      throw new PlanProjectionError(`plan projection bridge failed: ${describeSpawnError(error)}`);
    }

    return this.fromEnvelope(parseEnvelope<unknown>(stdout));
  }

  /** Unwrap a bridge envelope; any structured error is a 500-class projection error. */
  private fromEnvelope(envelope: BridgeEnvelope<unknown>): unknown {
    if (envelope.ok) {
      return envelope.data;
    }
    const { code, message } = envelope.error;
    throw new PlanProjectionError(`plan projection bridge error [${code}]: ${message}`, { code });
  }
}

/** Whitelist the env handed to the subprocess and force the repo root onto PYTHONPATH. */
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

/** Parse the final JSON envelope line printed by the bridge. */
function parseEnvelope<T>(stdout: string): BridgeEnvelope<T> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new PlanProjectionError("plan projection bridge returned no output");
  }
  const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
  try {
    return JSON.parse(lastLine) as BridgeEnvelope<T>;
  } catch {
    throw new PlanProjectionError(`plan projection bridge returned non-JSON output: ${trimmed}`);
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

/**
 * Runtime-validate the projected value into a `PlanView` (Contract 7). A
 * malformed projection is a 500-class internal error, never a silent partial
 * plan handed to the HTTP layer.
 */
function assertValidPlanView(value: unknown, planId: string): PlanView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlanProjectionError(`projected PlanView for ${planId} is not an object`);
  }
  const view = value as Record<string, unknown>;
  const missing: string[] = [];
  if (typeof view.planId !== "string" || view.planId.length === 0) missing.push("planId");
  if (typeof view.planLineageId !== "string" || view.planLineageId.length === 0) {
    missing.push("planLineageId");
  }
  if (typeof view.revisionNumber !== "number") missing.push("revisionNumber");
  if (typeof view.status !== "string" || view.status.length === 0) missing.push("status");
  if (typeof view.query !== "string") missing.push("query");
  if (!Array.isArray(view.steps)) missing.push("steps");
  if (!isGraphShape(view.graph)) missing.push("graph");
  if (missing.length > 0) {
    throw new PlanProjectionError(
      `projected PlanView for ${planId} is missing/invalid fields: ${missing.join(", ")}`,
    );
  }
  return value as PlanView;
}

function isGraphShape(graph: unknown): boolean {
  if (typeof graph !== "object" || graph === null) return false;
  const g = graph as Record<string, unknown>;
  return Array.isArray(g.nodes) && Array.isArray(g.edges);
}
