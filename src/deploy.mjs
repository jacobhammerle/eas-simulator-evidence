// Deploys a built site folder to EAS Hosting and returns its URL.
//
//   await deploySite({ siteDir, alias }) -> { url, aliasUrl, deploymentUrl }
//
// eas deploy is one command, but its output is progress lines followed by
// JSON, and the stable per-alias URL sits inside that JSON. This wraps
// the parsing so a pipeline gets a plain URL back. Any static host works
// for the site; this helper is only a convenience for EAS Hosting.
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

export function parseDeployOutput(raw) {
  const s = String(raw ?? "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error(`eas deploy printed no JSON:\n${s}`);
  const d = JSON.parse(s.slice(start));
  const aliasUrl = d.aliases?.[0]?.url || "";
  const deploymentUrl = d.url || "";
  if (!aliasUrl && !deploymentUrl) throw new Error("eas deploy printed no URL");
  return { url: aliasUrl || deploymentUrl, aliasUrl, deploymentUrl };
}

export function deploySite({
  siteDir,
  alias,
  projectDir = process.cwd(),
  easCliVersion = process.env.EAS_CLI_VERSION || "latest",
  log = console,
  // Injection point for tests: (file, args, options) -> stdout.
  exec = execFileSync,
} = {}) {
  if (!siteDir) throw new Error("deploySite: siteDir is required");
  // eas deploy joins --export-dir onto the project dir, so an absolute
  // path gets doubled. Pass it relative to the project root.
  const exportDir = relative(projectDir, resolve(siteDir)) || ".";
  const args = [
    "--yes",
    `eas-cli@${easCliVersion}`,
    "deploy",
    "--export-dir",
    exportDir,
    "--non-interactive",
    "--json",
  ];
  if (alias) args.push("--alias", alias);
  log.log(`[deploy] eas deploy --export-dir ${exportDir}${alias ? ` --alias ${alias}` : ""}`);
  const raw = exec("npx", args, {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 16 * 1024 * 1024,
  });
  return parseDeployOutput(raw);
}
