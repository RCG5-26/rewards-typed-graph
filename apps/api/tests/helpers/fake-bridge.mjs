// Stand-in for hero_bridge.py used by BridgePlanService unit tests. Run via
// `node fake-bridge.mjs <command> ...args`. Mode is encoded in the forwarded
// args (the env allowlist strips arbitrary test vars, so we can't use env).
//
//   ...includes "__ERROR__"        → {ok:false, not_found} on stdout, exit 1
//   ...includes "__UNKNOWNCODE__"  → {ok:false, weird} on stdout, exit 0
//   ...includes "__NONJSON__"      → non-JSON line, exit 0
//   otherwise                      → {ok:true, data:{command, argv}} on stdout
const argv = process.argv.slice(2);
const joined = argv.join(" ");

if (joined.includes("__ERROR__")) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { code: "not_found", message: "no such plan" } }) + "\n",
  );
  process.exit(1);
}

if (joined.includes("__UNKNOWNCODE__")) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { code: "weird", message: "boom" } }) + "\n",
  );
  process.exit(0);
}

if (joined.includes("__NONJSON__")) {
  process.stdout.write("totally not json\n");
  process.exit(0);
}

const [command] = argv;
// Emit a preamble line first so the test also proves parseEnvelope reads only
// the LAST stdout line as the JSON envelope.
process.stdout.write("bridge preamble line (ignored)\n");
process.stdout.write(JSON.stringify({ ok: true, data: { command, argv } }) + "\n");
