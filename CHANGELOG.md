# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/jacobhammerle/eas-simulator-evidence/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jacobhammerle/eas-simulator-evidence/releases/tag/v0.1.0
