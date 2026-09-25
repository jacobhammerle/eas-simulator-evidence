# Contributing

Thanks for helping. This is a small project with one maintainer, so the bar is: keep it small, keep it tested, keep it dependency-free.

## Questions

Open a [discussion](https://github.com/jacobhammerle/eas-simulator-evidence/discussions) for questions and ideas. Use issues for bugs and concrete feature requests.

## Bugs

Search existing issues first. A good report has the command you ran, the output, your Node version, and, when the page is wrong, the `session.json` that produced it with anything private removed.

## Development

```sh
git clone https://github.com/jacobhammerle/eas-simulator-evidence
cd eas-simulator-evidence
npm test          # the whole suite, about two seconds
npm run demo      # build the fixture and open it
```

There is no build step and no `npm install`. The CLI runs straight from `bin/` and `src/`.

Layout:

| Path | What |
| --- | --- |
| `bin/` | The CLI. Argument handling and output only. |
| `src/build.mjs` | Renders `index.html` from an evidence directory. |
| `src/collect.mjs` | Pulls and normalizes a session's artifacts. `normalizeSession` is pure. |
| `src/verdict.mjs` | The verdict grammar. Every reader goes through it. |
| `assets/` | Stylesheet, fonts, icons. Copied next to the page. |
| `fixtures/` | A real run, used by the tests and the demo. |
| `recipes/` | CI examples. `init` copies them. |
| `test/` | Node's built-in test runner. |

## Pull requests

- Add or update a test for what you change. The renderer tests build the fixture and check the markup; the collector tests replay raw artifacts; the CLI tests run the binary.
- Run `npm test` before you push.
- Keep the page self-contained: no CDN, no runtime dependency.
- Treat every field from a session as untrusted input.
- One change per pull request. Small ones get reviewed fast.
- Add a line under `Unreleased` in `CHANGELOG.md`.

## Releases

Maintainer only. Versions follow [semver](https://semver.org/). The `session.json` schema has its own `schemaVersion`; a breaking change to it is a major release.

1. Move the `Unreleased` entries in `CHANGELOG.md` under a new version heading with today's date.
2. `npm version <major|minor|patch>` to bump `package.json` and tag.
3. `git push --follow-tags`. The release workflow publishes to npm with provenance and creates the GitHub release.
