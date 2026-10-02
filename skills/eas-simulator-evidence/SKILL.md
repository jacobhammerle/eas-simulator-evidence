---
name: eas-simulator-evidence
description: Turn an EAS Simulator run into a shareable evidence page (verdict, screenshots, the agent's timeline, CPU and memory charts, the recording). Use after driving an app on an EAS cloud simulator, iOS or Android, when the result must be shown to a human, posted on a pull request, or kept as proof. Not for local simulators.
---

# eas-simulator-evidence

Builds a static evidence site from an EAS Simulator run. Runs with `npx`, needs Node 20+, has no dependencies.

## The contract

You produce three things. The tool does the rest.

1. **Screenshots in a folder, in capture order.** Name them with a leading number and a short caption: `evidence/1-home.png`, `evidence/2-settings-toggle.png`. The caption becomes the tile label. Save one screenshot per state you want a human to see. Or skip saving and pass `--screenshots` to `run` or `collect`; it downloads the session's own captures.
2. **A verdict line.** One line, a keyword, a colon, a sentence a reviewer can act on:
   - `PASS: <what was checked and what you saw>`
   - `FAIL: Screenshot N shows <what is wrong>` — name the screenshot so the page flags it
   - `REPLICATED: <the reported bug happened, how>` / `NOT-REPLICATED: <it did not>`
   - `CONFIRMED: <same as REPLICATED, if that is how the task is phrased>`
   - `INCONCLUSIVE: <why no verdict>`
   Write it as line 1 of `verdict.txt`. Everything after line 1 is your report and is shown on the page. Markdown works there: `## ` headings, `- ` bullets, `code`, **bold**, links.
3. **A subject.** `PR #12`, `Issue #7`, `Nightly · iOS`.

## Before you drive

The eas-simulator skill covers starting and driving the session. Three things there matter for the page:

- Start with `--name "<what this run checks>"` and, if the project groups runs, `--tag <label>`. Both show on the page and on expo.dev.
- Start with `--build-id` when you have one. The page then gets a "Try this build" button (iOS only).
- Save screenshots as you go, named as in the contract. A screenshot taken right after a tap gets a ring where the tap landed.

## Order of operations

```sh
# After the app has been driven and the screenshots are saved.
# --build-id adds the "Try this build" button. --agent is the name shown on the page.
npx eas-simulator-evidence@latest run evidence --stop \
  --subject "PR #12" --verdict-file verdict.txt \
  --build-id "$BUILD_ID" --agent "<your name>"
```

`--stop` makes the tool stop the session before collecting. Do not run `eas simulator:stop` yourself first: it clears `.env.eas-simulator`, and the tool reads the session id from that file. If the session is already stopped, pass `--session <id>`. It waits up to three minutes for the artifacts, then builds `evidence/site/`. A missing session never fails the run; the page is then screenshots only.

Then one of:

```sh
npx eas-simulator-evidence@latest open evidence                       # look at it locally
npx eas-simulator-evidence@latest deploy evidence --alias pr-12-evidence   # EAS Hosting, prints the URL
npx eas-simulator-evidence@latest comment evidence "$URL" --verdict-file verdict.txt --agent "<your name>" \
  | gh pr comment 12 --body-file -                                     # the PR comment
```

## Driving the app so the evidence is right

Lessons from real runs with agent-device on EAS Simulator:

- **`open <bundleId>` first, always.** Even when `simulator:start --build-id` installed and launched the app, `screenshot` and `snapshot` fail with `SESSION_NOT_FOUND` until you run `open`.
- **Re-read the tree before every tap.** `snapshot -i` refs (`@e8`) are numbered per screen. A ref from the Home tree points at something else on the Shop screen. A tap with a stale ref lands on the wrong control and the run is wrong without any error. Pattern: `snapshot -i` → find the ref by its label → `press` → wait → `screenshot` → `snapshot -i` again.
- **Press the control, not its label.** In a list row the label and the switch are separate nodes. A press on the label node does nothing and the run is wrong without any error. Press the `[switch]`, `[button]`, or `[cell]` node, then read the tree to see the value change.
- **Verify from the tree, not from the tap.** A tap that "worked" proves nothing. Before you write PASS for a screen, find its evidence in the tree: the tab button marked `[selected]`, a `screen-<name>` node, a heading. Put that check in the report.
- **Wait after a tap.** Two to four seconds before the screenshot, or the capture shows the old screen.
- **Screenshot after the tap you want to show.** The page draws a ring on a screenshot where the last tap before it landed, and links that tap to the screenshot in the timeline. A tap with no screenshot before the next tap gets neither. Keep screenshots at the default scale, or pass `--scale` so the session records it and the ring still lands.
- **Name and tag the session** with `--name "<what this run checks>"` and `--tag <label>` (repeatable, stored lowercased). The name is how a human finds it on expo.dev later, and tags group runs there (`simulator:list --tag`). The page shows both in the facts row.
- **Stop through the tool.** `run --stop` stops the session and keeps its id. A manual `eas simulator:stop` first clears `.env.eas-simulator` and the page ends up with no session data.
- **One session per run.** If a session is still booting, wait for it. Starting another creates a second bill and overwrites the dotenv.

## Android

The same commands work with `--platform android`. What differs on the page:

- **No performance section.** Android sessions upload no CPU or memory metrics. The page has no "Performance" section and `metrics` is null in `session.json`. This is expected, not a failed collect. The collector does not wait for metrics on Android.
- **No "Try this build" button.** expo.dev create-session links open an iOS preview only, so the page leaves the button out.
- **`open` takes the application id**, for example `com.example.app`, where iOS takes the bundle id. Tap rings, the timeline, and the recording work the same.

## Rules

- Let `run --stop` stop the session. Artifacts do not exist until the session stops, and stopping by hand first loses the id.
- Never put a secret in a screenshot name, the verdict, or the report. The page is public once hosted.
- One verdict per run. If several things failed, name the first screenshot that shows a failure and list the rest in the report.
- Use `--json` when another program reads the result. `build` and `run` print one line: `{ siteDir, images, videos, session, kind, verdict, report, url, durationMs, manifest }`. Everything else goes to stderr.
- In CI, add `--fail-on fail` (or `not-pass`) so the job fails on the verdict, after the site is built and deployed. Add `--junit path.xml` when the CI shows JUnit results.
- Do not open the `webPreviewUrl` on the device and do not embed it on the page. It is for a human's browser.

## Reading a page

`kind` is `pass`, `fail`, `replicated`, or `neutral`. The site folder contains `evidence.json`, a small manifest with the subject, verdict, image list, and session facts (id, name, tags, platform, device, durations, counts), for tooling that needs to read the result without parsing HTML.
