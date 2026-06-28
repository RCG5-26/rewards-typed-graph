// Stand-in for hero_bridge.py used by PythonWriteBridge unit tests. Invoked as
// `node fake-write-bridge.mjs <command> --flag value ...`. The mode is encoded
// in the --idempotency-key so a test can steer the envelope without env vars
// (the allowlist strips arbitrary test vars).
//
//   key contains "CONFLICT" → {ok:false, error:{code:"idempotency_conflict"}} exit 1
//   key contains "VALERR"   → {ok:false, error:{code:"validation"}}           exit 1
//   key contains "NONJSON"  → non-JSON line                                   exit 0
//   otherwise               → {ok:true, data:{mutationTxnId, idempotencyReplayed:false}}
const argv = process.argv.slice(2);
const command = argv[0];

function readFlag(name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function emit(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(code);
}

const key = readFlag("--idempotency-key") ?? "";

if (key.includes("CONFLICT")) {
  emit({ ok: false, error: { code: "idempotency_conflict", message: "duplicate" } }, 1);
}
if (key.includes("VALERR")) {
  emit({ ok: false, error: { code: "validation", message: "bad input" } }, 1);
}
if (key.includes("NONJSON")) {
  process.stdout.write("not json at all\n");
  process.exit(0);
}

// Echo the command back in the txn id so the test can prove which subcommand
// each mutation kind marshalled into.
emit({ ok: true, data: { mutationTxnId: `txn:${command}`, idempotencyReplayed: false } });
