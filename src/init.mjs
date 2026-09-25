// `init <target>` copies a recipe into the conventional place in a
// project, the way `playwright init` or `eslint --init` leave a file you
// then edit. It never overwrites without --force, and it adds the two
// evidence paths to .gitignore.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const recipesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "recipes");

export const TARGETS = {
  "eas-workflows": {
    recipe: "eas-workflows.yml",
    dest: ".eas/workflows/pr-evidence.yml",
    next: "Set EXPO_TOKEN_SIMULATOR in the project's EAS environment variables, then push. The workflow runs on every pull request.",
  },
  "github-actions": {
    recipe: "github-actions.yml",
    dest: ".github/workflows/pr-evidence.yml",
    next: "Add the EXPO_TOKEN secret and the EAS_SIMULATOR_BUILD_ID variable in the repository settings, then push.",
  },
  "gitlab-ci": {
    recipe: "gitlab-ci.yml",
    dest: ".gitlab-ci.evidence.yml",
    next: "Include it from .gitlab-ci.yml with `include: .gitlab-ci.evidence.yml` and set the EXPO_TOKEN and EAS_SIMULATOR_BUILD_ID CI variables.",
  },
  local: {
    recipe: "local.sh",
    dest: "scripts/evidence.sh",
    next: "Run it with an EAS simulator build id: bash scripts/evidence.sh <build-id>.",
  },
};

const GITIGNORE_LINES = [
  "# EAS Simulator session config (holds a session auth token)",
  ".env.eas-simulator",
  "# Evidence produced by simulator runs",
  "evidence/",
];

export function ensureGitignore(projectDir) {
  const file = join(projectDir, ".gitignore");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = new Set(current.split("\n").map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => l.startsWith("#") || !lines.has(l));
  const needed = missing.filter((l) => !l.startsWith("#"));
  if (!needed.length) return { file, added: [] };
  const block = [];
  if (needed.includes(".env.eas-simulator")) block.push(GITIGNORE_LINES[0], GITIGNORE_LINES[1]);
  if (needed.includes("evidence/")) block.push(GITIGNORE_LINES[2], GITIGNORE_LINES[3]);
  const sep = current && !current.endsWith("\n") ? "\n\n" : current ? "\n" : "";
  writeFileSync(file, current + sep + block.join("\n") + "\n");
  return { file, added: needed };
}

export function initRecipe({ target, projectDir = process.cwd(), force = false } = {}) {
  const t = TARGETS[target];
  if (!t) {
    throw new Error(`unknown target "${target}". Choose one of: ${Object.keys(TARGETS).join(", ")}`);
  }
  const dest = join(projectDir, t.dest);
  if (existsSync(dest) && !force) {
    throw new Error(`${t.dest} already exists. Pass --force to overwrite it.`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(recipesDir, t.recipe), dest);
  const ignore = ensureGitignore(projectDir);
  return { dest: t.dest, next: t.next, gitignoreAdded: ignore.added };
}
