# Fixtures

Real output from an EAS Simulator run, committed so the tests and the demo work
without a simulator or an Expo account.

## qa-checklist-ios

One lane of a QA swarm against the [Employee Onboarding](https://github.com/jacobhammerle/employee-onboarding)
demo app. An agent opened the Checklist tab, toggled one task on, toggled it back
off, and took a screenshot after each step.

| File | What it is |
| --- | --- |
| `1-checklist.png`, `2-task-toggled-on.png`, `3-task-toggled-off.png` | The agent's screenshots, in capture order |
| `verdict.txt` | The agent's verdict file. Line 1 is the verdict, the rest is the report |
| `session/session.json` | Written by `collect`: facts, timeline, metrics, recording link |
| `session/events.ndjson` | The session's raw activity events, as the platform uploaded them |
| `session/metrics.ndjson` | The session's raw per-second CPU, memory, and network samples |

Session `01a0d92e-195f-7045-a13c-23181fd8fc70`, iPhone 17, iOS 26.5, argent controller, 2026-09-25.
The recording is linked by URL and needs access to the project on expo.dev.
