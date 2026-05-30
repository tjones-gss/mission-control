/**
 * Thin TypeScript wrapper — invokes Python orchestrator with JSON contract.
 * Use in GitHub Actions or Node CI pipelines.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.env.HARNESS_ROOT ?? process.cwd();

export function harnessStatusJson(): string {
  const r = spawnSync("python", [path.join(root, "tools/harness"), "status", "--json"], {
    cwd: root,
    encoding: "utf-8",
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout;
}

export function runMissionLoop(opts: {
  runtime?: "local" | "cloud";
  dryRun?: boolean;
  autoPr?: boolean;
} = {}): number {
  const args = [
    "-m",
    "harness_orchestrator",
    "run-loop",
    "--cwd",
    root,
    "--runtime",
    opts.runtime ?? "local",
  ];
  if (opts.dryRun) args.push("--dry-run");
  if (opts.autoPr) args.push("--auto-pr");
  const r = spawnSync("python", args, { cwd: root, stdio: "inherit" });
  return r.status ?? 1;
}

if (require.main === module) {
  const dry = process.argv.includes("--dry-run");
  process.exit(runMissionLoop({ dryRun: dry }));
}
