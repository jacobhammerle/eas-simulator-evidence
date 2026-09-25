#!/usr/bin/env bash
# The whole loop on one machine: start a cloud simulator, drive it, stop it,
# build the evidence site, open it. Swap step 2 for any controller or agent.
#
# Needs: an Expo account with EAS Simulator access (npx eas-cli login),
#        an iOS simulator build id from EAS Build (eas build -p ios --profile preview)
set -euo pipefail

BUILD_ID=${1:?usage: local.sh <eas-build-id>}
EVIDENCE=evidence
rm -rf "$EVIDENCE" && mkdir -p "$EVIDENCE"

# 1. Start a session with the build preinstalled and launched. eas-cli
#    writes the session id and the controller's connection info to
#    .env.eas-simulator (keep that file out of git).
npx --yes eas-cli@latest simulator:start --platform ios --type agent-device \
  --build-id "$BUILD_ID" --max-duration-minutes 20 --non-interactive \
  --name "Local evidence run"
trap 'npx --yes eas-cli@latest simulator:stop --non-interactive >/dev/null 2>&1 || true' EXIT

# 2. Drive the app. This is the part you replace: an AI agent, a Maestro
#    flow, an Appium script, or a few controller commands like these.
#    Save screenshots into $EVIDENCE in capture order: 1-..., 2-..., 3-...
exec_ad() { npx --yes eas-cli@latest simulator:exec npx agent-device@latest "$@" --platform ios; }
exec_ad screenshot "$EVIDENCE/1-home.png"
exec_ad snapshot -i > /dev/null
exec_ad screenshot "$EVIDENCE/2-after-snapshot.png"
VERDICT="PASS: the app launched and rendered its home screen"

# 3. Stop the session, collect its artifacts, and build the site. --stop
#    lets the tool stop the session: `eas simulator:stop` clears
#    .env.eas-simulator, and the tool needs the id from it first.
npx --yes eas-simulator-evidence@latest run "$EVIDENCE" --stop \
  --subject "Local run" --verdict "$VERDICT" \
  --build-id "$BUILD_ID" --agent "agent-device"
trap - EXIT

open "$EVIDENCE/site/index.html" 2>/dev/null || xdg-open "$EVIDENCE/site/index.html"
