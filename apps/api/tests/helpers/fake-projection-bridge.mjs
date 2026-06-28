// Stand-in for hero_bridge.py `read-plan` used by BridgePlanProjection unit
// tests. Run via `node fake-projection-bridge.mjs read-plan --user-id U --plan-id P`.
// Mode is encoded in the forwarded args (the env allowlist strips arbitrary test
// vars, so we can't use env). It echoes the forwarded --user-id into the
// projected view's `summary` so a test can prove the call is user-scoped.
//
//   --plan-id __NOTFOUND__  → {ok:true, data:null}            (projection miss → null)
//   --plan-id __MALFORMED__ → {ok:true, data:{planId only}}   (fails runtime validation)
//   --plan-id __ERROR__     → {ok:false, internal} exit 1     (bridge error envelope)
//   --plan-id __NONJSON__   → non-JSON line, exit 0           (protocol error)
//   otherwise               → {ok:true, data:<valid PlanView>} exit 0
const argv = process.argv.slice(2);

function readFlag(name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function emit(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(code);
}

const planId = readFlag("--plan-id");
const userId = readFlag("--user-id");

if (planId === "__NOTFOUND__") emit({ ok: true, data: null });
if (planId === "__MALFORMED__") emit({ ok: true, data: { planId: "p1" } });
if (planId === "__ERROR__") {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { code: "internal", message: "boom" } }) + "\n",
  );
  process.exit(1);
}
if (planId === "__NONJSON__") {
  process.stdout.write("totally not json\n");
  process.exit(0);
}

const view = {
  planId,
  planLineageId: `lineage-${planId}`,
  revisionNumber: 1,
  status: "current",
  query: "Book a 3-night Hyatt award stay in Tokyo.",
  summary: `user:${userId}`,
  steps: [],
  graph: { nodes: [], edges: [] },
};

// Emit a preamble line first so the test also proves the adapter reads only the
// LAST stdout line as the JSON envelope.
process.stdout.write("bridge preamble line (ignored)\n");
emit({ ok: true, data: view });
