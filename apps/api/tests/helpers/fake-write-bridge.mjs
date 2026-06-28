// Stand-in for hero_bridge.py used by PythonWriteBridge unit tests. Invoked as
// `node fake-write-bridge.mjs <command> --flag value ...`. The mode is encoded
// in the --idempotency-key so a test can steer the envelope without env vars
// (the allowlist strips arbitrary test vars).
//
//   key contains "CONFLICT" → {ok:false, error:{code:"idempotency_conflict"}} exit 1
//   key contains "VALERR"   → {ok:false, error:{code:"validation"}}           exit 1
//   key contains "NONJSON"  → non-JSON line                                   exit 0
//   otherwise               → {ok:true, data:{mutationTxnId, observedEnv, ...}}
//
// The success envelope echoes back a whitelist of env keys actually present in
// the spawned process, so a test can assert what the subprocess *received* at
// the spawn boundary (rather than inspecting PythonWriteBridge internals).
const argv = process.argv.slice(2);
const command = argv[0];

// Keys a test cares about when proving the env allowlist. We only report keys
// that are actually set, so an absent key reads as "not forwarded".
const OBSERVABLE_ENV_KEYS = ["DATABASE_URL", "CLERK_SECRET_KEY", "PGHOST", "PATH"];

function observedEnv() {
  const seen = {};
  for (const key of OBSERVABLE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      seen[key] = process.env[key];
    }
  }
  return seen;
}

function readFlag(name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

// Wait for the write to flush before exiting; process.exit() can otherwise
// truncate piped stdout that the parent is still reading.
function writeThenExit(text, code) {
  process.stdout.write(text, () => process.exit(code));
}

function emit(obj, code = 0) {
  writeThenExit(JSON.stringify(obj) + "\n", code);
}

const key = readFlag("--idempotency-key") ?? "";

if (key.includes("CONFLICT")) {
  emit({ ok: false, error: { code: "idempotency_conflict", message: "duplicate" } }, 1);
} else if (key.includes("VALERR")) {
  emit({ ok: false, error: { code: "validation", message: "bad input" } }, 1);
} else if (key.includes("NONJSON")) {
  writeThenExit("not json at all\n", 0);
} else {
  // Echo the command back in the txn id so the test can prove which subcommand
  // each mutation kind marshalled into, plus the observed env for allowlist tests.
  emit({
    ok: true,
    data: {
      mutationTxnId: `txn:${command}`,
      idempotencyReplayed: false,
      observedEnv: observedEnv(),
    },
  });
}
