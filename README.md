<h1 align="center">eas-simulator-evidence</h1>

<p align="center">
  Turn an <a href="https://docs.expo.dev/eas/simulator/">EAS Simulator</a> run into a shareable evidence site.<br>
  The verdict, the screenshots, every device command, and the performance charts. One static page.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/eas-simulator-evidence"><img alt="npm" src="https://img.shields.io/npm/v/eas-simulator-evidence"></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="zero dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen">
</p>

<!-- Screenshot slot: a desktop capture of the demo page, about 1600px wide.
<p align="center">
  <img src="docs/screenshot-desktop.png" alt="An evidence page: a PASS verdict, three screenshots, the agent's timeline and CPU chart" width="800">
</p>
-->

<br>

An agent, a test runner, or a script drives your app on a cloud simulator. This tool takes what the run left behind and builds one page from it. Any app, any CI, any way of driving the device. The only requirement is that the run happened on EAS Simulator.

## Try it in one minute

No simulator and no Expo account needed. The repo ships a real run.

```sh
git clone https://github.com/jacobhammerle/eas-simulator-evidence
cd eas-simulator-evidence
npm run demo
```

## What you get

- **A verdict** as a status pill and a headline. `PASS`, `FAIL`, `REPLICATED`, and friends.
- **Screenshots** in capture order, with a full-screen viewer.
- **What the agent did.** Every tap, swipe, and screen read, with timing. Pulled from the session itself. Each screenshot shows a ring where the agent tapped.
- **App performance.** CPU, memory, and network for the whole run, with the taps marked on the charts.
- **The agent's report**, if it wrote one.
- **"Try this build"**, a button that opens the same build on a fresh simulator session on expo.dev.
- A link to the **full screen recording** and the raw data.

Paste the link in Slack or a pull request and the preview shows the verdict and the first screenshot. `#shot-3` in the URL opens the viewer on screenshot 3.

The page is one `index.html` plus its assets. Nothing loads from a CDN. It opens from a `file://` URL and hosts anywhere: EAS Hosting, GitHub Pages, a CI artifact, an S3 bucket. It looks right on a phone, in light and dark, with three screenshots or fifty.

<!-- Screenshot slot: the page on a phone, light and dark side by side.
<p align="center">
  <img src="docs/screenshot-phone.png" alt="The same page on a phone, in light and dark mode" width="600">
</p>
-->

## How it works

Your run gives the tool three things:

1. **A folder of screenshots**, saved in capture order: `1-home.png`, `2-settings.png`, and so on.
2. **A subject**, such as `PR #12`.
3. **A verdict line**, such as `PASS: the checkout flow completed`.

Everything else is optional and comes from the session.

```sh
# 1. Start a cloud simulator with your build installed
npx eas-cli@latest simulator:start --platform ios --type agent-device \
  --build-id "$BUILD_ID" --non-interactive --name "PR #12 evidence"

# 2. Drive the app your way. Save screenshots into evidence/. Decide on a verdict.
npx eas-cli@latest simulator:exec npx agent-device@latest screenshot evidence/1-home.png --platform ios
echo "PASS: the home screen rendered" > verdict.txt

# 3. Stop the session, collect its data, and build the site into evidence/site/
npx eas-simulator-evidence@latest run evidence --stop --subject "PR #12" --verdict-file verdict.txt --build-id "$BUILD_ID"

# 4. Look at it locally, or host it. With EAS Hosting:
npx eas-simulator-evidence@latest open evidence
npx eas-simulator-evidence@latest deploy evidence --alias pr-12-evidence
```

Step 2 is yours. An AI agent, a Maestro flow, Appium, or a shell script all work. If the run never saved a file, `run --screenshots` downloads the session's own captures instead.

Then post it where people look:

```sh
npx eas-simulator-evidence@latest comment evidence "$URL" --verdict-file verdict.txt | gh pr comment 12 --body-file -
```

## In CI

One command drops a ready-made workflow into your project:

```sh
npx eas-simulator-evidence@latest init github-actions   # or: eas-workflows, gitlab-ci, local
```

On GitHub, the tool is also an Action. After your run has saved its screenshots:

```yaml
- uses: jacobhammerle/eas-simulator-evidence@v0
  id: evidence
  with:
    dir: evidence
    subject: PR #${{ github.event.pull_request.number }}
    verdict-file: verdict.txt
    build-id: ${{ env.BUILD_ID }}
    deploy-alias: pr-${{ github.event.pull_request.number }}-evidence
  env:
    EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}

- run: echo "${{ steps.evidence.outputs.url }}"
```

Outputs: `url`, `site-dir`, `kind`, and `verdict`. Leave out `deploy-alias` and upload `site-dir` as an artifact instead.

## Recipes

The files `init` copies, if you would rather read them first:

| Recipe | What it does |
| --- | --- |
| [local.sh](recipes/local.sh) | The whole loop on your machine |
| [eas-workflows.yml](recipes/eas-workflows.yml) | Evidence on every pull request, as an EAS Workflow |
| [github-actions.yml](recipes/github-actions.yml) | Evidence on every pull request, from a Linux runner, with a PR comment |
| [gitlab-ci.yml](recipes/gitlab-ci.yml) | Evidence on every merge request, kept as a job artifact |

## Commands

```
eas-simulator-evidence run     <dir> --subject "<label>" --verdict "<line>"   collect, then build
eas-simulator-evidence build   <dir> --subject "<label>" --verdict "<line>"   build the site only
eas-simulator-evidence collect <dir> [--session <id>]                          pull the session data only
eas-simulator-evidence open    <dir>                                           serve the site on localhost
eas-simulator-evidence deploy  <dir> [--alias <name>]                          deploy to EAS Hosting
eas-simulator-evidence thumbs  <dir> <siteUrl>                                 thumbnails for a PR comment
eas-simulator-evidence verdict "<line>" [--badge]                              normalize a verdict line
eas-simulator-evidence comment <dir> <siteUrl> --verdict "<line>"              a pull-request comment
eas-simulator-evidence index   <dir-of-sites>                                  one page over many runs
eas-simulator-evidence sweep   [--older-than 30]                               stop stale preview sessions
eas-simulator-evidence init    <target>                                        copy a CI recipe into the project
```

Add `--junit report.xml` to `build` or `run` and the verdict shows up as a test in any CI. Add `--url` with the page's address and link previews get the first screenshot.

Run any command with `--help` for its options. The full reference, the verdict grammar, the session data schema, and the programmatic API are in [docs/reference.md](docs/reference.md).

## Requirements

- Node 20 or newer. No install step: run it with `npx`.
- An Expo account with EAS Simulator access, for the `collect` and `deploy` steps. In CI, set `EXPO_TOKEN` to a personal access token.

## Using it from an agent

The repo ships a skill file at [skills/eas-simulator-evidence/SKILL.md](skills/eas-simulator-evidence/SKILL.md). Point Claude Code, Cursor, or any agent that reads skills at it, and the agent knows how to name screenshots, write the verdict line, and run the tool.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in the [changelog](CHANGELOG.md).

## License

MIT
