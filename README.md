<h1 align="center">eas-simulator-evidence</h1>

<p align="center">
  Turn an <a href="https://docs.expo.dev/eas/simulator/">EAS Simulator</a> session into a shareable evidence site.<br>
  One static page with the verdict, screenshots, every device command, and the performance charts to help you easily consume what happened.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/eas-simulator-evidence"><img alt="npm" src="https://img.shields.io/npm/v/eas-simulator-evidence"></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="zero dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen">
</p>

<p align="center">
  <img src="docs/screenshot-desktop.png" alt="An evidence page: a PASS verdict, the run facts, the agent's report, three screenshots with the taps marked, and the action timeline" width="800">
</p>

<br>

I built this because I kept running my app on EAS Simulator, from an agent or a script, and had nothing to show for it afterwards except a folder of screenshots. Now the run ends with one page I can drop into a PR. It doesn't care what drove the device or where you host it. The one thing it needs is that the run happened on EAS Simulator.

## Try it in one minute

You don't need a simulator or an Expo account for this part. There's a real run checked into the repo.

```sh
git clone https://github.com/jacobhammerle/eas-simulator-evidence
cd eas-simulator-evidence
npm run demo
```

## What you get

- **The verdict** up top, as a pill and a headline. There are six:
  - `PASS`: it did what it was supposed to. Green.
  - `FAIL`: it didn't. Red, and the screenshot the verdict points at gets tagged.
  - `REPLICATED`: the bug you were chasing showed up. Amber, since the run itself was fine.
  - `CONFIRMED`: same thing as replicated, some agents just phrase it that way. Amber.
  - `NOT-REPLICATED`: the bug didn't show up. Green.
  - `INCONCLUSIVE`: couldn't tell. Grey.
- **Screenshots** in the order they were taken, with a full-screen viewer and a ring where the tap landed.
- **What actually happened on the device.** Every tap, swipe, and screen read, with timing, straight from the session. A tap links to the screenshot it caused, and clicking a time plays the recording from right there.
- **Performance.** CPU, memory, and network for the whole run, with the taps and the app launch marked. Hover to see the numbers and what was going on at that second.
- **The report** the agent wrote, rendered from Markdown. If it names a screenshot, that one opens in the viewer.
- **A "Try this build" button** that spins up the same build in a fresh simulator session on expo.dev.
- **The screen recording**, right on the page. It doesn't download a thing until you hit play. The raw data is down there too.

It's one `index.html` and its assets. Nothing comes from a CDN, it opens straight from `file://`, and it holds up on a phone, in light or dark, whether you've got three screenshots or fifty. Paste the link in Slack or a PR and the preview shows the verdict and the first screenshot.

<p align="center">
  <img src="docs/screenshot-phone.png" alt="The same page on a phone" width="300">
</p>

## How it works

You give it three things: a folder of screenshots in the order you took them (`1-home.png`, `2-settings.png`, and so on), a subject like `PR #12`, and a verdict line like `PASS: the checkout flow completed`. It pulls the rest out of the session.

```sh
# 1. Start a cloud simulator with your build installed
npx eas-cli@latest simulator:start --platform ios --type agent-device \
  --build-id "$BUILD_ID" --non-interactive --name "PR #12 evidence"

# 2. Drive the app your way. Save screenshots into evidence/. Decide on a verdict.
npx eas-cli@latest simulator:exec npx agent-device@latest screenshot evidence/1-home.png --platform ios
echo "PASS: the home screen rendered" > verdict.txt

# 3. Stop the session, collect its data, build the site into evidence/site/, deploy it
npx eas-simulator-evidence@latest run evidence --stop --subject "PR #12" \
  --verdict-file verdict.txt --build-id "$BUILD_ID" --deploy-alias pr-12-evidence

# 4. Post it where people look
npx eas-simulator-evidence@latest comment evidence "$URL" --verdict-file verdict.txt | gh pr comment 12 --body-file -
```

Step 2 is up to you. I use an agent, but a Maestro flow, Appium, or a plain shell script all work. If nothing saved a screenshot, `run --screenshots` grabs the session's own captures. Add `--fail-on fail` and the command exits 3 on a FAIL, after the site is up, so your CI job goes red without any extra scripting.

## In CI

I got tired of writing the same workflow over and over, so `init` drops one into your project:

```sh
npx eas-simulator-evidence@latest init github-actions   # or: eas-workflows, gitlab-ci, local
```

| Recipe | What it does |
| --- | --- |
| [github-actions.yml](recipes/github-actions.yml) | Evidence on every pull request, published to GitHub Pages, with a PR comment |
| [eas-workflows.yml](recipes/eas-workflows.yml) | Evidence on every pull request, as an EAS Workflow, on EAS Hosting |
| [gitlab-ci.yml](recipes/gitlab-ci.yml) | Evidence on every merge request, kept as a job artifact or on GitLab Pages |
| [local.sh](recipes/local.sh) | The whole loop on your machine |

It's also a GitHub Action. Once your run has saved its screenshots:

```yaml
- uses: jacobhammerle/eas-simulator-evidence@v0
  id: evidence
  with:
    subject: PR #${{ github.event.pull_request.number }}
    verdict-file: verdict.txt
    build-id: ${{ env.BUILD_ID }}
    deploy-alias: pr-${{ github.event.pull_request.number }}-evidence
    fail-on: fail
  env:
    EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
```

You get `url`, `site-dir`, `kind`, and `verdict` back as outputs. Skip `deploy-alias` and upload `site-dir` wherever you like.

## Host it anywhere

It's just a folder of static files with relative paths, so `evidence/site/` can go pretty much anywhere:

| Host | How |
| --- | --- |
| EAS Hosting | `run --deploy-alias pr-12-evidence`, or `deploy evidence --alias pr-12-evidence` |
| GitHub Pages | `actions/upload-pages-artifact` with `path: evidence/site`, then `actions/deploy-pages` |
| GitLab Pages | Copy it to `public/` in a `pages` job |
| S3, GCS, R2 | `aws s3 sync evidence/site s3://my-bucket/pr-12/` |
| Netlify, Vercel, Cloudflare Pages | Point the deploy at `evidence/site` |
| No host | Upload the folder as a CI artifact |

If you know the final URL, pass `--url` so link previews pick up the first screenshot. With `--deploy-alias` it already knows. Keeping a bunch of runs on one host? Give each its own folder and run `index` to get a landing page over all of them.

## Commands

```
eas-simulator-evidence run     <dir> --subject "<label>" --verdict "<line>"   collect, then build
eas-simulator-evidence build   <dir> --subject "<label>" --verdict "<line>"   build the site only
eas-simulator-evidence collect <dir> [--session <id>]                          pull the session data only
eas-simulator-evidence open    <dir>                                           serve the site on localhost
eas-simulator-evidence deploy  <dir> [--alias <name>]                          deploy to EAS Hosting
eas-simulator-evidence comment <dir> <siteUrl> --verdict "<line>"              a pull-request comment
eas-simulator-evidence thumbs  <dir> <siteUrl>                                 thumbnails for a comment
eas-simulator-evidence verdict "<line>" [--badge]                              normalize a verdict line
eas-simulator-evidence index   <dir-of-sites>                                  one page over many runs
eas-simulator-evidence sweep   [--older-than 30]                               stop stale preview sessions
eas-simulator-evidence init    <target>                                        copy a CI recipe into the project
```

Every command has `--help`. The full reference, the verdict grammar, the session data schema, and the programmatic API are all in [docs/reference.md](docs/reference.md).

## Requirements

- Node 20 or newer. Run it with `npx eas-simulator-evidence@<version>` or add it as a devDependency. If your pipeline has more than one job, each job that runs the tool needs its own install step.
- An Expo account with EAS Simulator access, for `collect`, `deploy`, and `sweep`. In CI, set `EXPO_TOKEN` to a personal access token. Nothing else in here touches the network.

## Using it from an agent

If you're on Claude Code, Cursor, or anything else that reads skills, point it at [skills/eas-simulator-evidence/SKILL.md](skills/eas-simulator-evidence/SKILL.md). It covers how to name screenshots, how to write the verdict line, and how to run the tool.

## Contributing

Issues and PRs are welcome. Have a look at [CONTRIBUTING.md](CONTRIBUTING.md) and the [changelog](CHANGELOG.md) first.

## License

MIT
