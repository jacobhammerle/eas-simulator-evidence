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
npx eas-cli@latest simulator:stop --non-interactive          # the platform finalizes events, metrics, recording on stop
npx eas-simulator-evidence@latest run evidence \
  --subject "PR #12" --verdict-file verdict.txt \
  --build-id "$BUILD_ID"                                      # adds the "Try this build" button
```

`run` reads the session id from `.env.eas-simulator` (eas-cli writes it) or `EAS_SIMULATOR_SESSION_ID`. It waits up to three minutes for the artifacts, then builds `evidence/site/`. A missing session never fails the run; the page is then screenshots only.

Then one of:

```sh
npx eas-simulator-evidence@latest open evidence                       # look at it locally
npx eas-simulator-evidence@latest deploy evidence --alias pr-12-evidence   # EAS Hosting, prints the URL
npx eas-simulator-evidence@latest comment evidence "$URL" --verdict-file verdict.txt --agent "my-agent" \
  | gh pr comment 12 --body-file -                                     # the PR comment
```

## Rules

- Stop the session before `collect` or `run`. Artifacts do not exist until then.
- Never put a secret in a screenshot name, the verdict, or the report. The page is public once hosted.
- One verdict per run. If several things failed, name the first screenshot that shows a failure and list the rest in the report.
- Use `--json` when another program reads the result. It prints `{ siteDir, kind, verdict, images, url }`.
- Add `--junit path.xml` to `build` or `run` when the CI shows JUnit results.
- Do not open the `webPreviewUrl` on the device and do not embed it on the page. It is for a human's browser.

## Reading a page

`kind` is `pass`, `fail`, `replicated`, or `neutral`. The site folder contains `evidence.json`, a small manifest with the subject, verdict, image list, and session facts, for tooling that needs to read the result without parsing HTML.
