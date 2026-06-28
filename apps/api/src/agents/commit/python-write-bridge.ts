/**
 * Thin TypeScript marshaller that converts validated specialist mutations
 * and plan lifecycle commands into hero_bridge.py subcommand calls (M3, M6).
 *
 * Transport: argv-in / one-JSON-line-stdout, shell:false, allow-listed env.
 * CLERK_SECRET_KEY is never forwarded. Timeout: 30s. MaxBuffer: 16MB.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { SpecialistMutation } from "../contracts";
import { CommitFailure } from "../contracts";

const execFileAsync = promisify(execFile);

const BRIDGE_SCRIPT = fileURLToPath(
  new URL("../../../bridge/hero_bridge.py", import.meta.url),
);
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

const BRIDGE_TIMEOUT_MS = 30_000;
const BRIDGE_MAX_BUFFER = 16 * 1024 * 1024;

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

export interface MutationCommitResult {
  readonly mutationTxnId: string;
  readonly idempotencyReplayed?: boolean;
}

export interface PlanCreateResult {
  readonly planId: string;
  readonly planLineageId: string;
  readonly revisionNumber: number;
}

export interface AgentRunCreateResult {
  readonly agentRunId: string;
}

export interface PythonWriteBridgeOptions {
  pythonBin?: string;
  cwd?: string;
  scriptPath?: string;
  env?: NodeJS.ProcessEnv;
}

export class PythonWriteBridge {
  private readonly pythonBin: string;
  private readonly cwd: string;
  private readonly scriptPath: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: PythonWriteBridgeOptions = {}) {
    this.pythonBin = options.pythonBin ?? process.env.PYTHON_BIN ?? "python3";
    this.cwd = options.cwd ?? REPO_ROOT;
    this.scriptPath = options.scriptPath ?? BRIDGE_SCRIPT;
    this.env = buildBridgeEnv(options.env ?? process.env);
  }

  async commitMutation(params: {
    mutation: SpecialistMutation;
    userId: string;
    planId: string;
    agentRunId: string;
    agentType: string;
    idempotencyKey: string;
    readSet: Readonly<Record<string, number>>;
  }): Promise<MutationCommitResult> {
    const { mutation } = params;

    switch (mutation.kind) {
      case "UpdateUserBalance":
        return this.run<MutationCommitResult>("orchestrator-record-mutation", [
          "--user-id", params.userId,
          "--plan-id", params.planId,
          "--agent-run-id", params.agentRunId,
          "--mutation-type", "UpdateUserBalance",
          "--target-node-id", mutation.balanceNodeId,
          "--target-table", "user_balances",
          "--idempotency-key", params.idempotencyKey,
          "--read-set", JSON.stringify(params.readSet),
          "--payload", JSON.stringify({ balancePoints: mutation.balancePoints }),
        ]);

      case "CreatePlanStep":
        // plan_lineage_id and revision_number are resolved server-side from plan_id
        return this.run<MutationCommitResult>("orchestrator-commit-step", [
          "--user-id", params.userId,
          "--plan-id", params.planId,
          "--agent-run-id", params.agentRunId,
          "--step-order", String(mutation.stepOrder),
          "--step-type", mutation.stepType,
          "--payload", JSON.stringify(mutation.payload),
          "--idempotency-key", params.idempotencyKey,
          "--read-set", JSON.stringify(params.readSet),
        ]);

      case "RecordStateDependency":
        return this.run<MutationCommitResult>("orchestrator-record-dependency", [
          "--user-id", params.userId,
          "--plan-step-id", mutation.planStepId,
          "--target-node-id", mutation.targetNodeId,
          "--target-node-type", mutation.target.targetNodeType,
          "--target-table", mutation.target.targetTable,
          "--observed-version", String(mutation.observedVersion),
          "--depended-property", mutation.target.dependedProperty,
          "--snapshot-value", JSON.stringify(mutation.target.snapshotValue),
          "--idempotency-key", params.idempotencyKey,
          "--read-set", JSON.stringify(params.readSet),
        ]);

      default: {
        const _exhaustive: never = mutation;
        throw new CommitFailure(
          "ValidationError",
          `unknown mutation kind: ${(_exhaustive as SpecialistMutation).kind}`,
        );
      }
    }
  }

  async createPlan(params: {
    userId: string;
    planLineageId: string;
    queryText: string;
  }): Promise<PlanCreateResult> {
    return this.run<PlanCreateResult>("orchestrator-create-plan", [
      "--user-id", params.userId,
      "--plan-lineage-id", params.planLineageId,
      "--query-text", params.queryText,
    ]);
  }

  async transitionPlanStatus(params: {
    userId: string;
    planId: string;
    toStatus: "current" | "failed";
  }): Promise<void> {
    await this.run<{ ok: true }>("orchestrator-transition-plan", [
      "--user-id", params.userId,
      "--plan-id", params.planId,
      "--status", params.toStatus,
    ]);
  }

  async createAgentRun(params: {
    planId: string;
    userId: string;
    agentType: string;
  }): Promise<AgentRunCreateResult> {
    return this.run<AgentRunCreateResult>("orchestrator-create-agent-run", [
      "--plan-id", params.planId,
      "--user-id", params.userId,
      "--agent-type", params.agentType,
    ]);
  }

  async finalizeAgentRun(params: {
    agentRunId: string;
    userId: string;
    status: "completed" | "failed";
    error?: string;
  }): Promise<void> {
    const args = [
      "--agent-run-id", params.agentRunId,
      "--user-id", params.userId,
      "--status", params.status,
    ];
    if (params.error) {
      args.push("--error", params.error);
    }
    await this.run<{ ok: true }>("orchestrator-finalize-agent-run", args);
  }

  private async run<T>(command: string, args: string[]): Promise<T> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        this.pythonBin,
        [this.scriptPath, command, ...args],
        {
          cwd: this.cwd,
          env: this.env,
          maxBuffer: BRIDGE_MAX_BUFFER,
          timeout: BRIDGE_TIMEOUT_MS,
          killSignal: "SIGKILL",
          shell: false,
        },
      ));
    } catch (error: unknown) {
      const captured = readStdout(error);
      if (captured.trim()) {
        return this.fromEnvelope<T>(parseEnvelope<T>(captured));
      }
      throw mapBridgeError(error);
    }

    return this.fromEnvelope<T>(parseEnvelope<T>(stdout));
  }

  private fromEnvelope<T>(envelope: BridgeEnvelope<T>): T {
    if (envelope.ok) {
      return envelope.data;
    }
    const { code, message } = envelope.error;
    throw mapBridgeErrorCode(code, message);
  }
}

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

function readStdout(error: unknown): string {
  if (error && typeof error === "object" && "stdout" in error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    if (typeof stdout === "string") {
      return stdout;
    }
  }
  return "";
}

function parseEnvelope<T>(stdout: string): BridgeEnvelope<T> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new CommitFailure("UnexpectedCommitError", "bridge returned no output");
  }
  const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
  try {
    return JSON.parse(lastLine) as BridgeEnvelope<T>;
  } catch {
    throw new CommitFailure(
      "UnexpectedCommitError",
      `bridge returned non-JSON output: ${trimmed.slice(0, 200)}`,
    );
  }
}

function mapBridgeError(error: unknown): CommitFailure {
  if (error && typeof error === "object") {
    if ("killed" in error && (error as { killed?: boolean }).killed === true) {
      return new CommitFailure("UnexpectedCommitError", "bridge subprocess timed out after 30s");
    }
    if ("code" in error && (error as { code?: string }).code === "ETIMEDOUT") {
      return new CommitFailure("UnexpectedCommitError", "bridge subprocess timed out after 30s");
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CommitFailure("UnexpectedCommitError", `bridge spawn failed: ${message}`);
}

function mapBridgeErrorCode(code: string, message: string): CommitFailure {
  switch (code) {
    case "conflict":
      return new CommitFailure("ConflictError", message);
    case "idempotency_conflict":
      return new CommitFailure("IdempotencyConflict", message);
    case "validation":
      return new CommitFailure("ValidationError", message);
    case "ownership":
      return new CommitFailure("OwnershipError", message);
    default:
      return new CommitFailure("UnexpectedCommitError", `[${code}] ${message}`);
  }
}
