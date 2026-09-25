# Reference

The full command reference, the verdict grammar, the session data schema, the programmatic API, and the notes on access and assets. The [README](../README.md) has the short version.

## Commands

### collect

Pulls the session's own artifacts into `<dir>/session/`: `session.json` (normalized facts, timeline, metrics, recording link), `events.ndjson`, and `metrics.ndjson`. Run it after `simulator:stop`. It polls `eas simulator:get` until the events and metrics artifacts exist, for up to three minutes by default.

It never fails your pipeline. Without a session id or with a session it cannot read, it prints a note and exits 0, and the site is built from screenshots alone.

| Option | Meaning |
| --- | --- |
| `--session <id>` | Session id. Default: `EAS_SIMULATOR_SESSION_ID`, then `.env.eas-simulator`, which eas-cli writes on `simulator:start` |
| `--dotenv <path>` | Dotenv file to read the session id from |
| `--extra k=v` | Extra fact stored in `session.json`. Repeatable |
| `--wait <seconds>` | Max wait for the artifacts. Default 180 |
| `--eas-cli-version <v>` | Version of eas-cli to run through `npx`. Default: `EAS_CLI_VERSION` or `latest` |
| `--screenshots` | Download the session's own screenshots into `<dir>` as `1-capture.png`, `2-capture.png`, ... in capture order. Only when `<dir>` holds no images yet |
| `--json` | Print a JSON summary to stdout |

### build

Writes the site to `<dir>/site/` or `--out`.

| Option | Meaning |
| --- | --- |
| `--subject <label>` | Page label. Required |
| `--verdict <line>` | The verdict line. Required, or use `--verdict-file` |
| `--verdict-file <path>` | Reads line 1 of the file as the verdict. The rest of the file becomes the "Agent report" section |
| `--report-file <path>` | Text for the "Agent report" section, shown as typed and folded when long |
| `--out <dir>` | Output folder. Default `<dir>/site` |
| `--name <text>` | App display name. Default: `expo.name` from `app.json` |
| `--owner <account>` | Expo account. Default: `expo.owner` from `app.json` |
| `--slug <slug>` | Expo project slug. Default: `expo.slug` from `app.json` |
| `--project-dir <dir>` | Where `app.json` lives. Default: the current directory |
| `--agent <text>` | The agent name shown on the page. Default `Agent` |
| `--build-id <id>` | The EAS build the run used. Adds the "Try this build" button |
| `--lane <text>` | A lane label for the run facts, for example `iOS · Checklist` |
| `--url <siteUrl>` | Where the page will be hosted. Enables the `og:image` link preview and the canonical link |
| `--junit <path>` | Also write a JUnit XML file with one test case for the run: pass, `<failure>` for FAIL, `<skipped>` for INCONCLUSIVE |
| `--json` | Print a JSON summary to stdout |

Projects with `app.config.js` or `app.config.ts` pass `--name`, `--owner`, and `--slug` as flags.

The "Try this build" button needs an owner, a slug, and a build id. Every click starts a new, billable simulator session on expo.dev under the viewer's account. The session name ends with `evidence-site preview`, so a cleanup job can find and stop those sessions.

### run

`collect`, then `build`, with every option of both. Add `--deploy-alias <name>` to also deploy to EAS Hosting and print the URL.

### open

Serves `<dir>/site` (or `--out`) on localhost and opens it in the browser, the way `npx playwright show-report` does. Stop it with Ctrl-C.

| Option | Meaning |
| --- | --- |
| `--port <n>` | Port. Default 9323, or a free port when that one is taken |
| `--host <host>` | Host. Default `127.0.0.1` |
| `--no-browser` | Print the URL only, for a remote box |

### deploy

Runs `eas deploy` on `<dir>/site` and prints the stable alias URL. A convenience for EAS Hosting only. Any static host works for the folder.

| Option | Meaning |
| --- | --- |
| `--alias <name>` | Stable alias, for example `pr-12-evidence` |
| `--out <dir>` | The site folder, when it is not `<dir>/site` |
| `--project-dir <dir>` | Expo project root. Default: the current directory |

### thumbs

Prints one line of linked thumbnails for a pull-request comment. Each image links to the full-size screenshot on the site. GitHub and GitLab both render it. `--max <n>` caps the count, default 4.

### verdict

Prints the normalized verdict line. `--badge` adds the status emoji for a comment. `--fallback <KEYWORD>` sets the keyword a malformed line gets, default `FAIL`.

### comment

Prints a pull-request comment in one fixed shape: a heading, the verdict with its emoji, an evidence link, extra bullets, a thumbnail row, the report folded in a details block, and a footer. Pipe it to `gh pr comment <n> --body-file -`.

| Option | Meaning |
| --- | --- |
| `--verdict <line>`, `--verdict-file <path>`, `--report-file <path>` | As for `build` |
| `--title <text>` | The heading. Default `Simulator evidence` |
| `--agent <text>` | Footer: `Posted by <agent>.` |
| `--line <text>` | An extra bullet. Repeatable |
| `--max <n>` | Thumbnails. Default 4 |

### index

One page over many built sites. Each run is a subfolder of `<dir>` that holds `index.html` and `evidence.json` (every `build` writes that manifest). The index lists a card per run, failures first, with the verdict pill, subject, first screenshot, device, duration, and a link. Deploy the whole folder as one site.

| Option | Meaning |
| --- | --- |
| `--out <dir>` | Output folder. Default `<dir>` |
| `--subject <label>` | Page title. Default `Runs` |
| `--name <text>` | App display name |

### sweep

Stops live simulator sessions that the "Try this build" button started once they are older than the limit. Those sessions come from expo.dev create-session links, which cannot set a duration, so they run until stopped. Run this on a schedule with an `EXPO_TOKEN` that can manage sessions. It only touches sessions whose name ends with the suffix, and it never fails the caller.

| Option | Meaning |
| --- | --- |
| `--older-than <min>` | Age limit in minutes. Default 30 |
| `--name-suffix <text>` | Default `evidence-site preview`, the suffix the page puts on those sessions |
| `--type <type>` | Session type to consider. Default `web-preview-only` |
| `--dry-run` | List what would be stopped |
| `--json` | Print `{ listed, candidates, stopped, kept, failed }` |

### init

Copies a recipe into the conventional place and adds `.env.eas-simulator` and `evidence/` to `.gitignore`. It never overwrites a file without `--force`.

| Target | Writes |
| --- | --- |
| `eas-workflows` | `.eas/workflows/pr-evidence.yml` |
| `github-actions` | `.github/workflows/pr-evidence.yml` |
| `gitlab-ci` | `.gitlab-ci.evidence.yml`, to include from `.gitlab-ci.yml` |
| `local` | `scripts/evidence.sh` |

### Conventions

- Results go to stdout. Notes, progress, and errors go to stderr. `--json` prints one JSON object to stdout and nothing else.
- Exit 0 on success, 1 when the work failed, 2 for a usage error such as an unknown option or a missing value. An unknown option is an error, not a warning.
- Color only on a terminal. `NO_COLOR` turns it off, `FORCE_COLOR` turns it on.
- Precedence: flags, then environment (`EAS_SIMULATOR_SESSION_ID`, `EAS_CLI_VERSION`), then files (`.env.eas-simulator`, `app.json`).
- `-h`, `--help`, `-v`, `--version`.

## GitHub Action

The repository is also a composite action. It runs the CLI that ships with the tag, so `@v0` is the 0.x line and `@v0.1.0` is one release.

```yaml
- uses: jacobhammerle/eas-simulator-evidence@v0
  id: evidence
  with:
    dir: evidence                 # default
    subject: PR #12               # required
    verdict-file: verdict.txt     # or verdict: "PASS: ..."
    build-id: ${{ env.BUILD_ID }}
    deploy-alias: pr-12-evidence  # optional; needs EXPO_TOKEN
  env:
    EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
```

Every CLI option has an input of the same name: `report-file`, `session`, `agent`, `lane`, `name`, `owner`, `slug`, and `working-directory` for the Expo project root. Outputs are `url`, `site-dir`, `kind`, and `verdict`.

## The evidence directory

- Screenshots: `.png`, `.jpg`, `.jpeg`. Sorted naturally, so `2-` comes before `10-`. The leading number is dropped from the caption and the rest becomes it: `2-settings-toggle.png` reads "Settings toggle".
- Clips the agent recorded: `.mp4`, `.mov`. Embedded with a download link.
- `session/session.json` and the NDJSON files, written by `collect`.
- Anything else is ignored and not copied to the site.

The page pairs the n-th successful screenshot command in the session timeline with the n-th image in the directory. Save screenshots in capture order and the pairing holds.

## The verdict line

One line, a keyword, a colon, then a sentence.

| Keyword | Pill | Meaning |
| --- | --- | --- |
| `PASS` | green | The run met its pass condition |
| `FAIL` | red | It did not |
| `NOT-REPLICATED` | green | The reported bug did not happen |
| `REPLICATED`, `CONFIRMED` | amber | The reported bug did happen. The run itself did not fail |
| `INCONCLUSIVE`, anything else | grey | No clear result |

Agents do not always write the line cleanly, so every reader normalizes it the same way:

- A chain of keywords collapses to the last one. `PASS: FAIL: count stuck` is a FAIL.
- A PASS line that still says FAIL is a FAIL.
- A line with no keyword becomes `FAIL: malformed verdict line: ...`.
- A failing verdict that names `Screenshot N` gets tile N tagged on the page, and the timeline row that captured it highlighted.

## The site folder

`build` writes, next to `index.html`:

- the screenshots and clips, under their own names
- `colors_and_type.css` and `fonts/`
- `session/` with `session.json` and the NDJSON files, when collected
- `evidence.json`, a manifest: `subject`, `verdict`, `kind`, `projectName`, `agentName`, `url`, `buildId`, `images`, `firstImage`, `videos`, `report` (length), and `session` (id, platform, status, device, runtime, durationMs, bootMs, counts, dashboardUrl). The `index` command and bots read this instead of the HTML.

The page itself: `#shot-N` in the URL opens the viewer on screenshot N. Each screenshot that followed a tap shows a ring at the tap's position when the controller reported it as a fraction of the screen (argent does; agent-device reports points, which need a device size the session does not carry). A banner above the verdict says when the session errored or was still running at collection time.

## Session data

`collect` writes `session.json` with `schemaVersion: 1`.

| Field | Content |
| --- | --- |
| `id`, `name`, `platform`, `type`, `status` | Session identity. `type` is the controller: `agent-device`, `argent`, `appium` |
| `createdAt`, `startedAt`, `finishedAt`, `bootMs`, `durationMs` | Timing |
| `device` | `name`, `runtime`, `udid`, `hostCores` |
| `dashboardUrl` | The session on expo.dev |
| `recording` | `url`, `bytes`, `width`, `height`, `firstFrameAt`. Linked, never copied |
| `anchorIso` | The instant timeline offsets count from: the recording's first frame, else session start |
| `metrics.samples[]` | One sample per second: `t`, `cpu`, `memMB`, `netIn`, `netOut`, `app` |
| `metrics.summary` | Peak and average CPU and memory over the samples where the app was running |
| `timeline[]` | One entry per device command: `ts`, `offsetMs`, `kind`, `tool`, `label`, `outcome`, `durationMs`, tap coordinates when known, `screenshotIndex` on captures |
| `counts` | `operations`, `taps`, `screenshots`, `failed`, `describes` |
| `uploadedScreenshots[]` | The screenshots the platform kept, with their artifact URLs |
| `extra` | The `--extra` pairs you passed |

Timeline `kind` is one of `tap`, `type`, `swipe`, `open`, `describe`, `screenshot`, `wait`, `alert`, `recording`, `other`. The timeline reads both agent-device and argent event shapes.

See [fixtures/qa-checklist-ios/session/session.json](../fixtures/qa-checklist-ios/session/session.json) for a complete example, and [fixtures/qa-checklist-ios/raw/simulator-get.json](../fixtures/qa-checklist-ios/raw/simulator-get.json) for the raw `simulator:get` output it was made from. The schema is the contract for anyone who wants to render the data another way.

## Programmatic use

```js
import { collectSession, buildSite, deploySite } from "eas-simulator-evidence";

await collectSession({ dir: "evidence", sessionId, extra: { lane: "iOS · Home" } });
const { siteDir, kind } = buildSite({
  dir: "evidence",
  subject: "PR #12",
  verdict: "PASS: the home screen rendered",
  report: "Everything rendered on first launch.",
  projectName: "My App",
  expoOwner: "acme",
  expoSlug: "my-app",
  buildId,
});
const { url } = deploySite({ siteDir, alias: "pr-12-evidence" });
```

Also exported: `normalizeSession`, `normalizeTimeline`, `normalizeMetrics`, `parseVerdict`, `normalizeVerdict`, `verdictBadge`, `thumbsHtml`, `resolveProject`, `imageSize`.

`collectSession` and `deploySite` accept injection points (`getSession`, `fetchText`, `sleep`, `exec`) so they can run without the network.

## Access and tokens

- EAS Simulator sessions need an Expo account with access to the feature. In CI, set `EXPO_TOKEN` to a personal access token from expo.dev → Account → Access tokens. Inside EAS Workflows the token EAS injects is restricted and cannot create sessions, so store a personal token as a separate variable and export it as `EXPO_TOKEN` in the job.
- `.env.eas-simulator` holds a session token. Keep it out of git.
- `collect` and `deploy` run eas-cli through `npx`. Nothing else in the tool talks to the network.

## Design notes

- The page treats every field from a session as untrusted. Text is escaped, only `https` links become links, and a missing field drops one section instead of breaking the page.
- Long content folds: a timeline after 40 rows, a report after about 18 lines. Long verdicts step the headline down in size.
- Screenshot tiles use each image's own aspect ratio, read from the PNG or JPEG header. Landscape captures span two columns.
- Breakpoints at 860px, 640px, and 380px. Nothing that carries information is hidden on a phone.
- The theme follows the OS. A toggle in the nav picks system, light, or dark, remembered in `localStorage`.

## Third-party assets

| Asset | Source | License |
| --- | --- | --- |
| Inter (variable) | Google Fonts, latin subset | SIL Open Font License 1.1 |
| JetBrains Mono (variable) | Google Fonts, latin subset | SIL Open Font License 1.1 |
| Lucide icons | lucide-static | ISC |
| Color and type tokens | Derived from `expo/styleguide` | MIT |
