# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-28

### Added

- Tap rings for agent-device runs. The controller reports taps in points; the page now maps them onto the screenshot (the image's pixel size at the default 1x capture, divided by `--scale` when the collector recorded one). Before, only argent runs got rings.
- The platform's full-session recording embedded on the page under "Recording", with `preload="none"` so it costs nothing until play. "Watch the run" in the hero jumps to it, and every time in the timeline plays it from that moment.
- A tap, swipe, or typing step links to the screenshot that followed it.
- Chart hover: a crosshair across all charts with the value at that moment and the agent's step within 2.5 s. The app launch is marked on the charts with a solid hairline.
- The collector keeps agent-device's `target` and `targetLabel` on timeline entries. A resolved label names the tap.
- `--fail-on fail|not-pass` on `build` and `run`: exit 3 after the site is built and deployed when the verdict matches, so a CI job goes red on the verdict without a script around the tool. The Action takes it as `fail-on` and writes its outputs before failing.
- `run --deploy-alias` builds the page with the alias address (`https://<slug>--<alias>.expo.app`) when `--url` is not given, so canonical links and link previews work on the first deploy; it warns if the deploy reports another address. `aliasUrl` is exported.
- `comment --footer <text>` for a footer line other than "Posted by <agent>."
- The Action takes `url` and `junit`.
- A tab icon: the Expo mark, as an SVG that follows the OS theme, with a PNG fallback and an Apple touch icon. The `index` page gets it too.
- README: a "Host it anywhere" section (GitHub Pages, GitLab Pages, S3, Netlify, Vercel, Cloudflare Pages, a CI artifact), and a note on running the tool from a job that did not install `node_modules`. The GitLab recipe shows the Pages variant.
- `--stop` on `collect` and `run`, and a `stop` input on the Action: the tool stops the session itself before collecting.
- A "Driving the app so the evidence is right" section in the skill file, from the first real runs: open the app before the first screenshot, re-read the tree before every tap, verify screens from the tree, wait after taps, stop through the tool.

### Changed

- No "Try this build" button on an Android run: expo.dev create-session links open an iOS browser preview only.
- The status pill sits above the verdict headline instead of beside it, so the headline takes the full width.
- The verdict headline is display-sized (36px, stepping down to 28px and 20px for long verdicts; 26px on phones) so the page reads as a report at a glance.
- The agent report renders as Markdown: headings, bullet and numbered lists, fenced code, block quotes, rules, inline code, bold, links, and bare URLs. Everything is escaped first, only http(s) URLs become links, and unknown syntax stays as typed. It folds to a short preview after 8 lines (was 18, as a raw text block clipped at a fixed height) and the button opens it fully and folds it again.
- A screenshot the report names (`2-checklist.png`, in a code span or bare) is a link that opens the viewer on it.
- `renderMarkdown` and `inlineMarkdown` are exported from the programmatic API.
- The tool now runs a pinned eas-cli release (`24.8.0`) through `npx` instead of `latest`, so a new eas-cli release cannot change the JSON the tool parses without a release here. `--eas-cli-version` and `EAS_CLI_VERSION` still override it. The constant is exported as `DEFAULT_EAS_CLI_VERSION`.

### Fixed

- `eas simulator:stop` clears `.env.eas-simulator`, so a `collect` after a manual stop found no session id and silently built a screenshots-only page. The recipes, the skill file, and the docs now stop through the tool.

## [0.1.0] - 2026-09-25

### Added

- `build`: a static evidence page from a folder of screenshots, a subject, and a verdict line. Verdict pill, screenshot grid with a lightbox, the agent's report, light and dark themes, a layout that works from 320px up.
- `collect`: pulls an EAS Simulator session's events, metrics, and recording link into `session.json` (schema version 1). Reads both agent-device and argent event shapes.
- The page renders the session: run facts, command breakdown, the action timeline, CPU and memory charts with taps marked, raw data downloads, and a "Try this build" link to a fresh simulator session.
- `run`, `deploy`, `open`, `thumbs`, `verdict`, and `init` commands.
- A composite GitHub Action (`action.yml`).
- Recipes for EAS Workflows, GitHub Actions, GitLab CI, and a local run.
- A real run committed as a fixture, so `npm run demo` works without an account.
- `collect --screenshots` downloads the session's own captures when the run saved none.
- Tap rings on screenshots, a network chart, a session-health banner, link-preview tags, `#shot-N` permalinks, and an `evidence.json` manifest in every site.
- `comment`, `index`, and `sweep` commands, `--junit` and `--url` on `build` and `run`.
- A skill file for AI agents at `skills/eas-simulator-evidence/SKILL.md`.

[Unreleased]: https://github.com/jacobhammerle/eas-simulator-evidence/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jacobhammerle/eas-simulator-evidence/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jacobhammerle/eas-simulator-evidence/releases/tag/v0.1.0
