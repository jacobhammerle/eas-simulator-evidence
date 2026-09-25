# Security

## Reporting a vulnerability

Do not open a public issue. Use [GitHub's private vulnerability reporting](https://github.com/jacobhammerle/eas-simulator-evidence/security/advisories/new) for this repository. You will get a reply within a week.

## What counts

The page is built from data that an agent, a controller, or the EAS platform produced. That data is treated as untrusted: text is escaped, only `https` links become links, and file names are URL-encoded. A way to get script execution or a non-`https` link onto a built page from any input is a vulnerability.

The tool runs `eas-cli` through `npx` for `collect` and `deploy`, and nothing else touches the network. Anything that changes that is a vulnerability.

## Supported versions

The latest minor release receives fixes.
