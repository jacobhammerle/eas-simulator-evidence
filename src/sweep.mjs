// Stops simulator sessions that outlived their purpose.
//
//   await sweepSessions({ olderThanMin: 30, nameSuffix: "evidence-site preview" })
//
// The page's "Try this build" button is an expo.dev create-session link.
// Such links cannot set a duration, so those sessions get the account
// default and bill until stopped. This sweep, run on a schedule, is the
// cap: it lists live sessions, keeps the ones that match the name suffix
// and are older than the limit, and stops them. It never touches a
// session with another name, and it never fails the caller.
import { execFileSync } from "node:child_process";
import { parseCliJson } from "./collect.mjs";

export const PREVIEW_SUFFIX = "evidence-site preview";

function runEas(args, easCliVersion) {
  const raw = execFileSync(
    "npx",
    ["--yes", `eas-cli@${easCliVersion}`, ...args, "--json", "--non-interactive"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 },
  );
  return parseCliJson(raw);
}

// Lists every live session of the given type, following pagination.
export async function listLiveSessions({ type, eas, limit = 100 } = {}) {
  const all = [];
  let after;
  for (let page = 0; page < 20; page++) {
    const args = ["simulator:list", "--status", "new", "--status", "in-progress", "--limit", String(limit)];
    if (type) args.push("--type", type);
    if (after) args.push("--after", after);
    const out = await eas(args);
    const sessions = Array.isArray(out) ? out : out?.sessions || out?.items || [];
    all.push(...sessions);
    const next = out?.pageInfo?.hasNextPage ? out.pageInfo.endCursor : null;
    if (!next || !sessions.length) break;
    after = next;
  }
  return all;
}

export async function sweepSessions({
  olderThanMin = 30,
  nameSuffix = PREVIEW_SUFFIX,
  type = "web-preview-only",
  dryRun = false,
  easCliVersion = process.env.EAS_CLI_VERSION || "latest",
  now = () => Date.now(),
  log = console,
  eas = (args) => runEas(args, easCliVersion),
} = {}) {
  const note = (m) => log.log(`[sweep] ${m}`);
  let sessions;
  try {
    sessions = await listLiveSessions({ type, eas });
  } catch (e) {
    note(`simulator:list failed: ${String(e.message).split("\n")[0]}`);
    return { listed: 0, candidates: [], stopped: [], kept: [], failed: [], dryRun };
  }
  const suffix = String(nameSuffix || "").toLowerCase();
  const candidates = sessions.filter((s) =>
    suffix ? String(s.name || "").toLowerCase().endsWith(suffix) : true,
  );
  note(
    `${sessions.length} live ${type || ""} session(s), ${candidates.length} match "${nameSuffix}", limit ${olderThanMin} min${dryRun ? " (dry run)" : ""}`,
  );
  const stopped = [];
  const kept = [];
  const failed = [];
  for (const s of candidates) {
    const created = Date.parse(s.createdAt);
    const ageMin = Number.isFinite(created) ? (now() - created) / 60000 : Infinity;
    const label = `${s.id} "${s.name}" (${s.status}, ${Number.isFinite(ageMin) ? ageMin.toFixed(0) : "?"} min old)`;
    if (!(ageMin >= olderThanMin)) {
      kept.push(s.id);
      note(`keep    ${label}`);
      continue;
    }
    if (dryRun) {
      stopped.push(s.id);
      note(`would stop ${label}`);
      continue;
    }
    try {
      await eas(["simulator:stop", "--id", s.id]);
      stopped.push(s.id);
      note(`stopped ${label}`);
    } catch (e) {
      failed.push(s.id);
      note(`stop failed for ${s.id}: ${String(e.message).split("\n")[0]}`);
    }
  }
  note(`done: ${stopped.length} ${dryRun ? "would be " : ""}stopped, ${kept.length} kept, ${failed.length} failed`);
  return { listed: sessions.length, candidates: candidates.map((s) => s.id), stopped, kept, failed, dryRun };
}
