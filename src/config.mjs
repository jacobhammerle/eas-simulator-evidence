// Resolves the app facts the page needs: display name, Expo account, and
// project slug. Explicit values win; app.json in the project dir fills the
// rest. app.config.js/ts projects pass the values as flags or point
// --project-dir at a folder with an app.json.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readAppJson(projectDir = process.cwd()) {
  const file = join(projectDir, "app.json");
  if (!existsSync(file)) return null;
  try {
    const app = JSON.parse(readFileSync(file, "utf8"));
    return app.expo || app;
  } catch {
    return null;
  }
}

export function resolveProject({
  projectDir = process.cwd(),
  name,
  owner,
  slug,
} = {}) {
  const app = readAppJson(projectDir) || {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  return {
    projectName: str(name) || str(app.name) || "App",
    expoOwner: str(owner) || str(app.owner) || "",
    expoSlug: str(slug) || str(app.slug) || "",
    source: existsSync(join(projectDir, "app.json")) ? "app.json" : "flags",
  };
}
