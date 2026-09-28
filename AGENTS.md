# AGENTS.md

Guidance for an AI agent working in this repository. Humans: read
[CONTRIBUTING.md](CONTRIBUTING.md) instead. It is the source of truth, and this
file points at it rather than repeating it.

## First, which job is this?

There are two, and they use different files.

**Using the tool on a real run.** Driving an app on an EAS Simulator and turning
that run into an evidence page. Read
[skills/eas-simulator-evidence/SKILL.md](skills/eas-simulator-evidence/SKILL.md)
and stop there. It has the screenshot naming, the verdict grammar, the command
order, and the rules for driving a device so the evidence is right. You do not
need this file.

**Changing this repository.** The rest of this file.

## Setup

```sh
npm test          # the whole suite, about two seconds
npm run demo      # build the committed fixture and open the page
```

No `npm install` and no build step. The package has zero runtime dependencies
and zero dev dependencies. The CLI runs straight from `bin/` and `src/` on
Node 20 or newer.

The layout table is in [CONTRIBUTING.md](CONTRIBUTING.md#development).

## Rules that are easy to break by accident

- **No dependencies.** Not runtime, not dev. The zero-dependency badge is a
  promise. Use the Node standard library or write the twenty lines.
- **The page stays self-contained.** No CDN, no script tag pointing outward. A
  built site must open from a `file://` URL with the network off.
- **Every field from a session is untrusted input.** It reaches the HTML.
  Escape it.
- **Tests never touch the network or `eas-cli`.** The three modules that shell
  out take injection points for exactly this reason: `getSession`,
  `stopSession`, and `fetchText` in [src/collect.mjs](src/collect.mjs), and
  `exec` in [src/deploy.mjs](src/deploy.mjs) and [src/sweep.mjs](src/sweep.mjs).
  Pass a fake. The only `fetch` calls in the suite hit the tool's own localhost
  server.
- **The eas-cli version is pinned in one place.** `DEFAULT_EAS_CLI_VERSION` in
  [src/config.mjs](src/config.mjs). Bump it there. Do not write a version
  literal or a dist-tag into a module, and do not change the default back to
  `latest`. A test guards this.
- **The verdict grammar has one home.** [src/verdict.mjs](src/verdict.mjs).
  Every reader goes through it. Do not parse a verdict line anywhere else.
- **`session.json` has its own `schemaVersion`.** A breaking change to that
  shape is a major release, so raise it rather than deciding alone.
- **Windows is in CI.** Checkouts are LF everywhere, readers tolerate CRLF, and
  file names that are illegal on Windows are skipped. Keep new tests portable.

## Before you say you are done

1. `npm test` passes. The suite runs on Node 20, 22, and 24, plus macOS and
   Windows, so a local pass is necessary and not sufficient.
2. A test covers what you changed. Renderer tests build the fixture and check
   the markup. Collector tests replay raw artifacts. CLI tests run the binary.
3. A line is added under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
4. The change is one change. Small ones get reviewed fast.

## Do not do these without being asked

- Publish, tag, or run `npm version`. Releases are maintainer-only and the
  steps are in [CONTRIBUTING.md](CONTRIBUTING.md#releases).
- Restructure directories or rewrite a module that already passes its tests.
- Add a framework, a bundler, a linter, or a formatter.
- Commit a real session's data. Fixtures are scrubbed on purpose.
