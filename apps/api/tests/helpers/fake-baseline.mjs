// Stand-in for the Python LLM baselines used by baseline-bridge subprocess tests.
// Invoked as `node fake-baseline.mjs <mode>`; the mode steers stdout/stderr/exit
// so a test can exercise the REAL execFile boundary without calling OpenAI.
//
//   valid         → one clean JSON report on stdout, exit 0
//   malformed     → broken JSON on stdout, exit 0
//   empty         → no stdout, exit 0
//   exit          → stderr note + nonzero exit
//   stderr-secret → secret-shaped tokens on stderr + nonzero exit (sanitization)
//   env           → JSON of the env keys the child actually received, exit 0
//   sleep         → never writes in time (test sets a short timeout)
//
// Encoding the mode in argv (not env) is deliberate: the bridge's env allowlist
// would strip an arbitrary control var, so argv is the only reliable channel.

const mode = process.argv[2] ?? "valid";
const GINZA = "award:demo_hyatt_ginza:tokyo:3n";

function report() {
  return JSON.stringify({
    architecture: "fake_baseline",
    cases: [
      {
        case_id: "demo_transfer_required_tokyo",
        token_cost_total: 1234,
        status: "current",
        actual_top_award_slug: GINZA,
        baseline_plan_record: {
          raw_output: {
            status: "current",
            chosen_award_slug: GINZA,
            ranked_awards: [{ award_slug: GINZA }],
            steps: [{ summary: "Redeem Ginza", reasoning: "Best value." }],
          },
        },
      },
    ],
  });
}

// Env keys a test cares about when proving the allowlist. Only set keys are
// reported, so an absent key reads as "not forwarded".
const OBSERVABLE_ENV_KEYS = [
  "OPENAI_API_KEY",
  "DATABASE_URL",
  "CLERK_SECRET_KEY",
  "PGHOST",
  "PYTHONPATH",
  "PATH",
];

function observedEnv() {
  const seen = {};
  for (const key of OBSERVABLE_ENV_KEYS) {
    if (process.env[key] !== undefined) seen[key] = process.env[key];
  }
  return seen;
}

switch (mode) {
  case "valid":
    process.stdout.write(report());
    break;
  case "malformed":
    process.stdout.write("{ this is not valid json ");
    break;
  case "empty":
    break;
  case "exit":
    process.stderr.write("baseline crashed while reasoning\n");
    process.exit(3);
    break;
  case "stderr-secret":
    process.stderr.write("auth failed sk-ABCD1234EFGH5678 OPENAI_API_KEY=sk-supersecretvalue\n");
    process.exit(1);
    break;
  case "env":
    process.stdout.write(JSON.stringify({ observedEnv: observedEnv() }));
    break;
  case "sleep":
    setTimeout(() => process.stdout.write(report()), 10_000);
    break;
  default:
    process.stdout.write(report());
}
