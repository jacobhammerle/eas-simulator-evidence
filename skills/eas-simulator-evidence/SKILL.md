---
name: eas-simulator-evidence
description: Turn an EAS Simulator run into a shareable evidence page (verdict, screenshots, the agent's timeline, CPU and memory charts). Use after driving an app on an EAS cloud simulator when the result must be shown to a human, posted on a pull request, or kept as proof. Not for local simulators.
---

# eas-simulator-evidence

Builds a static evidence site from an EAS Simulator run. Runs with `npx`, needs Node 20+, has no dependencies.

## The contract

You produce three things. The tool does the rest.

1. **Screenshots in a folder, in capture order.** Name them with a leading number and a short caption: `evidence/1-home.png`, `evidence/2-settings-toggle.png`. The caption becomes the tile label. Save one screenshot per state you want a human to see. Or skip saving and pass `--screenshots` to `collect`; it downloads the session's own captures.
2. **A verdict line.** One line, a keyword, a colon, a sentence a reviewer can act on:
   - `PASS: <what was checked and what you saw>`
   - `FAIL: Screenshot N shows <what is wrong>` — name the screenshot so the page flags it
   - `REPLICATED: <the reported bug happened, how>` / `NOT-REPLICATED: <it did not>`
   - `INCONCLUSIVE: <why no verdict>`
   Write it as line 1 of `verdict.txt`. Everything after line 1 is your report and is shown on the page.
3. **A subject.** `PR #12`, `Issue #7`, `Nightly · iOS`.

## Order of operations

```sh
# after the app has been driven and screenshots saved:
npx eas-simulator-evidence@latest run evidence --stop \
  --subject "PR #12" --verdict-file verdict.txt \
  --build-id "$BUILD_ID"                                      # adds the "Try this build" button
```

`--stop` makes the tool stop the session before collecting. Do not run `eas simulator:stop` yourself first: it clears `.env.eas-simulator`, and the tool reads the session id from that file. If the session is already stopped, pass `--session <id>`. It waits up to three minutes for the artifacts, then builds `evidence/site/`. A missing session never fails the run; the page is then screenshots only.

Then one of:

```sh
npx eas-simulator-evidence@latest open evidence                       # look at it locally
npx eas-simulator-evidence@latest deploy evidence --alias pr-12-evidence   # EAS Hosting, prints the URL
npx eas-simulator-evidence@latest comment evidence "$URL" --verdict-file verdict.txt --agent "my-agent" \
  | gh pr comment 12 --body-file -                                     # the PR comment
```

## Driving the app so the evidence is right

Lessons from real runs with agent-device on EAS Simulator:

- **`open <bundleId>` first, always.** Even when `simulator:start --build-id` installed and launched the app, `screenshot` and `snapshot` fail with `SESSION_NOT_FOUND` until you run `open`.
- **Re-read the tree before every tap.** `snapshot -i` refs (`@e8`) are numbered per screen. A ref from the Home tree points at something else on the Shop screen. A tap with a stale ref lands on the wrong control and the run is wrong without any error. Pattern: `snapshot -i` → find the ref by its label → `press` → wait → `screenshot` → `snapshot -i` again.
- **Verify from the tree, not from the tap.** A tap that "worked" proves nothing. Before you write PASS for a screen, find its evidence in the tree: the tab button marked `[selected]`, a `screen-<name>` node, a heading. Put that check in the report.
- **Wait after a tap.** Two to four seconds before the screenshot, or the capture shows the old screen.
- **Name the session** with `--name "<what this run checks>"`. It is how a human finds it on expo.dev later.
- **Stop through the tool.** `run --stop` stops the session and keeps its id. A manual `eas simulator:stop` first clears `.env.eas-simulator` and the page ends up with no session data.
- **One session per run.** If a session is still booting, wait for it. Starting another creates a second bill and overwrites the dotenv.

## Rules

- Let `run --stop` stop the session. Artifacts do not exist until the session stops, and stopping by hand first loses the id.
- Never put a secret in a screenshot name, the verdict, or the report. The page is public once hosted.
- One verdict per run. If several things failed, name the first screenshot that shows a failure and list the rest in the report.
- Use `--json` when another program reads the result. It prints `{ siteDir, kind, verdict, images, url }`.
- Add `--junit path.xml` to `build` or `run` when the CI shows JUnit results.
- Do not open the `webPreviewUrl` on the device and do not embed it on the page. It is for a human's browser.

## Reading a page

`kind` is `pass`, `fail`, `replicated`, or `neutral`. The site folder contains `evidence.json`, a small manifest with the subject, verdict, image list, and session facts, for tooling that needs to read the result without parsing HTML.
