# Testing

Last reviewed: 2026-06-29.

Use the cheapest layer that covers the change. The simulator is useful for HUD
layout and event logic, but it is not hardware emulation.

## CI / PR Default

These scripts are suitable for default CI because they use TypeScript, Vitest,
local package inspection, or static artifact audits:

- CI uses Node.js 22.19.0 or newer, matching `package.json` `engines.node`.
- `pnpm check`: source hygiene, script TypeScript, CSS module declarations,
  app typecheck, and app Vitest.
- `pnpm run ci`: default PR/CI gate.
- `pnpm release:check`: the implementation behind `ci`; it runs `check`
  plus dependency audit, Even Hub packaging,
  artifact hygiene, visual asset hygiene, manifest consistency, and submission
  asset consistency.

## Simulator

Simulator tests require the official Even Hub simulator automation server.

For normal development, point the simulator at the Vite dev server so HMR stays
active:

```bash
pnpm dev
pnpm sim:dev
```

The official simulator opens its own desktop window and may take focus on
macOS. Treat that as expected behavior. The repo does not try to fight the
window manager because focus restore proved unreliable across repeated
simulator launches.

For less disruptive development, avoid starting simulator windows unless the
change actually touches glasses layout, Even Hub events, page lifecycle, or
phone/glasses rendering parity. Reuse an existing simulator session when
possible and run `pnpm sim:capture` / `pnpm sim:e2e` against that session
instead of repeatedly launching a new one. For phone-only review, use the normal
browser with `openPanel` URLs first; it does not need the simulator.

The default dev URL is `http://127.0.0.1:5174`. The Vite config uses
`strictPort`, so if `5174` is already in use, stop the old dev server or start
Vite and the simulator manually with the same explicit alternate port:

```bash
pnpm dev -- --port <vite-port> --strictPort
pnpm simulator http://127.0.0.1:<vite-port> --automation-port 9898
```

To restart pairing from a clean local state, close the simulator or Even Hub
client first, then run:

```bash
pnpm dev:reset-pairing -- --dry-run
pnpm dev:reset-pairing
```

The `--dry-run` form only prints matching OpenClaw entries. The default command
removes paired OpenClaw `Even G2` node/device entries. Use the phone
`Connection` -> `Set up again` action to clear app-side storage before scanning
a fresh setup QR, or add `?resetPairing=1` to the local app URL during local
testing.

For repeatable built-artifact checks, serve `dist` instead:

```bash
pnpm build
pnpm serve:sim
pnpm sim:run
```

Capture screenshots:

```bash
pnpm sim:capture
```

The command writes four files and prints their paths:

- `glassesPath`: raw simulator glasses PNG. It may look like a solid green
  image in generic viewers because the useful signal is mostly alpha.
- `reviewPath`: black-background PNG generated from glasses alpha for human
  HUD review.
- `webviewPath`: phone WebView screenshot.
- `alphaPath`: greyscale alpha-channel PGM for low-level debugging.

Use the simulator for:

- startup page container creation;
- HUD blank-screen checks;
- glasses screenshot alpha-pixel checks;
- human HUD layout review through `reviewPath`;
- phone WebView blank-screen checks;
- basic `up`, `down`, `click`, and voice-state `double_click` event logic.

Even Hub rejects oversized text containers. Regression tests should cover long
session turns and picker lists so one screen never tries to send multiple turns
or an unbounded transcript into a single `TextContainer`. Long turns should be
split into screens such as `Agent (2/5)`.

Run the simulator E2E smoke against the currently loaded simulator state:

```bash
pnpm sim:e2e
```

`sim:e2e` captures the HUD and phone WebView, checks that both are nonblank,
and then selects the flow from the current HUD density:

- setup-like HUD: verifies first-run setup visibility;
- session-like HUD: verifies selected-session visibility. Session switching is
  owned by the phone Session selector, not by a glasses session picker.

Force a mode when needed:

```bash
EVENG2_SIM_FLOW=setup pnpm sim:e2e
EVENG2_SIM_FLOW=session pnpm sim:e2e
EVENG2_SIM_FLOW=voiceReview pnpm sim:e2e
EVENG2_SIM_FLOW=canvas pnpm sim:e2e
EVENG2_SIM_FLOW=approval pnpm sim:e2e
EVENG2_SIM_FLOW=recovery pnpm sim:e2e
```

`sim:e2e` is a UI smoke. It does not prove that real Gateway speech
transcription works because fixture flows can inject transcript events without
using a live provider.

### Emoji And Symbol Glyph Audit

The Even G2 text renderer can display a limited symbol font. Some characters
that desktop/mobile input methods classify as emoji, such as `♡`, `▶`, `□`, and
`★`, are regular supported text glyphs on the glasses. Other emoji code points
emit LVGL `glyph dsc. not found` warnings and render as missing glyphs.

Run the glyph audit when changing text normalization or deciding which
characters should pass through unchanged:

```bash
pnpm sim:emoji-glyphs
```

To test a specific user/session sample, pass it as grapheme clusters:

```bash
pnpm sim:emoji-glyphs -- --text '⚙️ 🔌 🔊 🪢 ♡ ▶ □ ★ 👍'
```

The script starts a local Vite server and the official simulator, renders each
candidate with the dev-only `simFixture=emojiProbe` view, captures the glasses
HUD, and writes:

```text
.openclaw-even-g2-node/emoji-glyph-report.json
```

Candidates with no matching LVGL missing-glyph warnings are probably
displayable. If the report marks `needsVisualReview: true`, inspect the
`reviewPath` image before adding the character to a pass-through allowlist,
because some simulator glyphs can be legible but still differ from the expected
desktop emoji shape. Unsupported candidates should be replaced with a compact
fallback before sending text to the glasses so a single missing glyph does not
expand into a long label on the HUD.

To test the real Review voice path against a running simulator, paired Even G2
node, OpenClaw Gateway, microphone, and configured Talk provider:

```bash
pnpm smoke:voice-review
```

Before running it, start the Vite app and simulator, pair/approve the node, and
play audible speech into the Mac microphone. The smoke:

- starts Review recording through the simulator input API;
- waits while real microphone PCM is sent to Gateway with
  `talk.session.appendAudio`;
- stops recording;
- fails if the app returns to the session screen instead of the Review draft;
- fails if the final HUD is too small to plausibly contain transcript text.

This catches regressions where the app can call the Talk protocol but the live
Gateway/provider path never returns a usable transcript. It is intentionally
not part of default CI because it depends on local audio, Gateway auth,
provider availability, and a running GUI simulator.

By default the smoke allows providers that only return a final transcript after
stop. To require live partial text during recording, run:

```bash
EVENG2_VOICE_REQUIRE_PARTIAL=1 pnpm smoke:voice-review
```

Useful tuning variables:

- `EVENG2_SIMULATOR_URL` (default `http://127.0.0.1:9898`)
- `EVENG2_VOICE_NODE` (default `Even G2`)
- `EVENG2_VOICE_RECORD_MS` (default `10000`)
- `EVENG2_VOICE_FINAL_LIT_PIXELS` (default `4500`)

To run the setup smoke and every dev-only fixture without manually switching
simulator URLs:

```bash
pnpm sim:fixtures
```

`sim:fixtures` starts and stops the required local app servers and Even Hub
simulator processes. It builds the app first, then covers setup, session
navigation, review-before-send, canvas, approval, and recovery fixture HUDs. For
interactive fixture states it also drives representative glasses input events:
session `up`/`down`, Review `tap send`, canvas `tap hide`, approval rerender and
`tap allow`, tutorial skip, and Send now cancellation. It writes
`.openclaw-even-g2-node/simulator-fixtures-report.json` for local debugging. The
report is written on both pass and failure and is Git-ignored. Treat it as
optional visual-smoke context, not release evidence: app permissions, packaged
runtime behavior, OpenClaw state, and real glasses behavior still need the
appropriate private/beta build checks.

## Agentic E2E Review

For Coding Agent development loops, use an evidence bundle instead of a brittle
pixel-perfect assertion. The goal is to let the agent compare simulator output,
OpenClaw node state, and [user-stories.md](user-stories.md) with fuzzy product
judgment.

Start the app and simulator as usual. For production-build simulator runs where
the agent needs structured HUD state logs, add `?e2eLog=1` to the app URL:

```bash
pnpm build
pnpm serve:sim
pnpm simulator 'http://127.0.0.1:35162/openclaw-even-g2-node/?e2eLog=1' --automation-port 9898
pnpm e2e:agent
```

`pnpm e2e:agent` writes a run directory under
`.openclaw-even-g2-node/e2e-agent-runs/` containing:

- a snapshot of `docs/user-stories.md`;
- simulator glasses and phone WebView screenshots;
- simulator console logs and structured glass state markers when available;
- OpenClaw `nodes status` and `canvas.snapshot` command evidence when the
  local `openclaw` CLI can reach the active Gateway;
- `review-prompt.md`, which tells the Coding Agent how to judge the run;
- `llm-review.template.json`, which the Coding Agent can replace with its
  structured verdict.

To include a live OpenClaw node display mutation, run:

```bash
pnpm e2e:agent:live
```

This also invokes `canvas.present` on the configured Even G2 node before reading
`canvas.snapshot`. Override the node or text when needed:

```bash
pnpm e2e:agent:live -- --node "Even G2" --canvas-text "E2E canvas check"
```

For live runs that should not touch the maintainer's everyday Gateway context,
start a dedicated test Gateway profile and pass that context explicitly. This
keeps Gateway config, sessions, pairing approvals, and node state out of the
default OpenClaw profile. The Even G2 platform is not one of OpenClaw's built-in
mobile platform IDs, so the throwaway Gateway also needs an explicit node
command allowlist for the canvas commands used by this E2E:

```bash
openclaw --profile eveng2-e2e config set gateway.nodes.allowCommands \
  '["canvas.present","canvas.hide","canvas.snapshot","talk.ptt.once"]' \
  --strict-json
openclaw --profile eveng2-e2e gateway --dev --force --port 19001 --auth none
```

In another terminal, generate the setup QR from the same profile, pair the
simulator or G2 app with that QR, then run the E2E evidence command against the
test Gateway. The current OpenClaw CLI still requires an explicit credential
when `--url` is passed, even for an `--auth none` local Gateway; use a throwaway
dummy token for this isolated profile:

```bash
export EVENG2_E2E_OPENCLAW_TOKEN="dummy-e2e-token"
openclaw --profile eveng2-e2e qr \
  --url ws://127.0.0.1:19001 \
  --token "$EVENG2_E2E_OPENCLAW_TOKEN"
pnpm device:approve:latest -- \
  --openclaw-profile eveng2-e2e \
  --url ws://127.0.0.1:19001 \
  --token "$EVENG2_E2E_OPENCLAW_TOKEN"
pnpm e2e:agent:live -- \
  --openclaw-profile eveng2-e2e \
  --openclaw-url ws://127.0.0.1:19001 \
  --openclaw-token "$EVENG2_E2E_OPENCLAW_TOKEN" \
  --node "Even G2" \
  --canvas-text "E2E canvas check"
```

If a fresh profile's CLI identity asks for additional operator scopes before
`pnpm device:approve:latest` can call `devices` or `nodes`, approve that
bootstrap request only inside the throwaway profile. Do not switch the repo
branch or reuse the maintainer's default Gateway state for this step.

The E2E bundle records the OpenClaw profile, URL, and whether a token was
provided. Token values are redacted from command evidence and manifests. If the
test Gateway is containerized, pass `--openclaw-container <name>` to
`pnpm device:approve:latest` and `pnpm e2e:agent:live` so every OpenClaw CLI
call crosses the same isolation boundary.

OpenClaw command isolation for this flow:

| Step | Command family | Isolation requirement |
| --- | --- | --- |
| Test Gateway | `openclaw --profile eveng2-e2e gateway ...` | Gateway runs under the dedicated profile/state. |
| Setup QR | `openclaw --profile eveng2-e2e qr --url ... --token ...` | QR points at the test Gateway URL/token. |
| Device/operator approval | `pnpm device:approve:latest -- --openclaw-profile eveng2-e2e --url ... --token ...` | Wrapper places profile/container before `devices ...` subcommands and URL/token on Gateway calls. |
| Node approval | same `pnpm device:approve:latest` run | Wrapper uses the same profile/container and URL/token for `nodes pending/status/approve`. |
| Node evidence | `pnpm e2e:agent:live -- --openclaw-profile eveng2-e2e --openclaw-url ... --openclaw-token ...` | Harness uses the same profile/container and URL/token for every `nodes invoke`. |
| Optional container boundary | add `--openclaw-container <name>` | Container global arg is applied before all OpenClaw subcommands. |

The intended reviewer is the Coding Agent itself, a separate Codex session, or
an OpenClaw-routed agent. The reviewer should return `pass`, `warn`, `fail`, or
`inconclusive` per story. It should treat missing evidence as inconclusive,
judge semantic user-story fit rather than exact wording, and fail regressions
where the phone becomes the primary chat surface or provider/Gateway ownership
moves into the app.

There is also a manual GitHub Actions workflow, `Simulator Fixtures`, that runs
the same command under `xvfb-run` and uploads the fixture report plus captured
simulator PNG/PGM files as artifacts. Keep it manual unless the simulator
proves stable enough in GitHub's Linux runner; the default CI gate intentionally
stays free of GUI simulator dependencies. The workflow installs Xvfb and
WebKitGTK runtime packages because the official simulator captures the phone
WebView through native WebKitGTK on Linux.

For a deterministic session flow that does not depend on a live OpenClaw
Gateway or maintainer pairing state, start the Vite dev server and simulator
with the dev-only session fixture:

```bash
pnpm dev
pnpm simulator 'http://127.0.0.1:5174/?resetPairing=1&simFixture=session' --automation-port 9898
EVENG2_SIM_FLOW=session pnpm sim:e2e
```

Replace `session` with `voiceReview`, `canvas`, `canvasTutorial`, `approval`,
`recovery`, `storeChat`, or `storeVoice` to run a visual smoke against those
fixture states. The
non-session fixture flows capture the HUD and phone WebView and verify that the
rendered output is visible; the `session` flow verifies selected-session HUD
visibility.

`simFixture` is available only in Vite development mode. It seeds small public
sample states so HUD behavior can be tested without private OpenClaw state:

- `simFixture=session`: selected-session view;
- `simFixture=voiceReview`: review-before-send transcript screen;
- `simFixture=canvas`: `canvas.present` pushed text screen;
- `simFixture=canvasTutorial`: first-run canvas tutorial sequence with image
  frames followed by the OpenClaw request prompt;
- `simFixture=approval`: glasses approval screen;
- `simFixture=recovery`: foreground/node unavailable recovery screen.
- `simFixture=storeChat`: store-listing chat preview using the real selected
  session renderer;
- `simFixture=storeVoice`: store-listing voice input preview using the real
  Review voice renderer.

To inspect only the canvas tutorial sequence, start the dev server and launch
the simulator directly at the fixture URL:

```bash
pnpm dev
pnpm simulator 'http://127.0.0.1:5174/?resetPairing=1&simFixture=canvasTutorial' --automation-port 9898
```

For a non-interactive visibility smoke against the same fixture, run:

```bash
EVENG2_SIM_FLOW=canvasTutorial pnpm sim:e2e
```

## Phone UI State Review

For phone layout review, use local URLs with `openPanel`. This is a lightweight
state catalog for the phone surface and is the preferred review path before
adding or updating screenshots. The `openPanel` parameter is intentionally
small and only opens a collapsed phone panel. It does not seed private state or
perform privileged actions.

Start the dev server:

```bash
pnpm dev
```

Useful phone states:

```text
http://127.0.0.1:5174/?resetPairing=1&disableEvenBridge=1
http://127.0.0.1:5174/?resetPairing=1&disableEvenBridge=1&setupCode=wss%3A%2F%2Fgateway.example%2Fws&openPanel=connection
http://127.0.0.1:5174/?resetPairing=1&disableEvenBridge=1&setupCode=wss%3A%2F%2Fgateway.example%2Fws&openPanel=voice
http://127.0.0.1:5174/?resetPairing=1&disableEvenBridge=1&setupCode=wss%3A%2F%2Fgateway.example%2Fws&openPanel=diagnostics
http://127.0.0.1:5174/?resetPairing=1&simFixture=session
http://127.0.0.1:5174/?resetPairing=1&simFixture=voiceReview&openPanel=voice
http://127.0.0.1:5174/?resetPairing=1&simFixture=canvasTutorial
http://127.0.0.1:5174/?resetPairing=1&simFixture=storeChat
http://127.0.0.1:5174/?resetPairing=1&simFixture=storeVoice
http://127.0.0.1:5174/?resetPairing=1&simFixture=recovery&openPanel=connection
```

Check at mobile widths first, especially around 393x852. The phone UI should
keep setup and recovery actions in the status card, keep manual setup as a
fallback, keep connection recovery buttons visually grouped, and keep
diagnostics collapsed unless a support/debug flow needs it.

This is still a simulator smoke, not a release gate for microphone permission,
BLE timing, foreground lifecycle, or packaged `.ehpk` behavior.

Do not use the simulator as proof for:

- BLE latency or frame pacing;
- real touch or R1 event quirks;
- microphone permission prompts;
- Android WebView lifecycle;
- packaged `.ehpk` install/review parity;
- real network whitelist behavior;
- locked-phone survival.

## Release Candidate / Real Device

Do not make Pixel or ADB automation a standing release requirement. It is too
environment-specific for normal maintainer release flow.

Use portal-installed private or beta builds for release parity:

- Portal private build install: checks manifest enforcement, icon/install UI,
  permission prompts, and first-frame boot.
- Beta build install: checks reviewer parity and locked-phone behavior.

Manual release checks:

- physical G2 touch flow: start on the selected-session screen. `up` and
  `down` move through session-log screens, `tap` starts voice, and the next
  `tap` stops or confirms voice depending on the selected voice mode. Root-page
  double tap should show the Even Hub system exit confirmation;
- phone Session selector flow: open the selector, verify that sessions refresh,
  choose another session key, and verify that the glasses switch to that
  selected session;
- network permission denial path;
- G2 microphone permission denial path;
- real G2 voice capture;
- Gateway disconnect/reconnect.

During the manual touch flow, observe the connected node from the OpenClaw host:

```bash
pnpm diag:touch-watch
```

When the app is loaded from the local Vite dev server, lower-level Even Hub
event payloads are also mirrored out of the phone UI. They are printed in the
`pnpm dev` terminal as `[Even G2 event] ...` and appended to:

```text
.openclaw-even-g2-node/even-hub-events.ndjson
```

This captures lifecycle payloads such as `FOREGROUND_ENTER_EVENT` and
`FOREGROUND_EXIT_EVENT` without making the phone Diagnostics screen the primary
debugging surface.

Packaged builds keep this raw logger disabled unless the app URL includes
`evenHubEventLog=1`. The previous `rawInputLog=1` switch is still accepted for
local diagnostics.

For lower-level debugging, use the OpenClaw CLI directly:

```bash
openclaw nodes list --json
openclaw nodes invoke --node <even-g2-node-id> --command device.status --params '{}' --json
openclaw nodes invoke --node <even-g2-node-id> --command canvas.snapshot --params '{}' --timeout 5000 --json
```

`canvas.snapshot` should match the current glasses HUD text. If it does not,
the node is not a reliable external OpenClaw surface even if the phone preview
looks correct.

## Release Gate

`pnpm run ci` is the default GitHub Actions gate and normal PR gate. It delegates
to `pnpm release:check`, which runs checks, audits, package inspection,
Even Hub manifest consistency, and submission asset consistency. It must pass
without private developer origins in `app.json` and without portal login.

The Even Hub package availability probe is best-effort by default because CI
does not have an Even Hub portal session. Set `EVENG2_REQUIRE_EVENHUB_LOGIN=1`
in a maintainer shell when that probe should be mandatory.

The current public-review posture intentionally leaves `network.whitelist`
empty because the Gateway endpoint is configured by the user at runtime.
`release:status` reports this as a review risk, not a hard local release-check
failure.

## Script Classification

| Script | Classification | Notes |
| --- | --- | --- |
| `pnpm check` | CI / PR default | Required inner-loop gate. |
| `pnpm run ci` | CI / PR default | Default GitHub Actions gate; delegates to `release:check`. |
| `pnpm css:types` | Development helper | Regenerates CSS Module declarations after CSS class changes. |
| `pnpm build` | Simulator / packaging | Produces `dist`. |
| `pnpm serve:sim` | Simulator support | Serves built client under `/openclaw-even-g2-node/`. |
| `pnpm sim:run` | Simulator | Starts official simulator against the local static URL. |
| `pnpm sim:capture` | Simulator | Requires simulator automation server. |
| `pnpm sim:fixtures` | Simulator / local visual smoke | Starts setup plus fixture simulator runs and checks HUD/WebView screenshots. |
| `pnpm e2e:agent` | Agentic local review | Collects simulator/OpenClaw evidence and writes a prompt for Coding Agent fuzzy review. |
| `pnpm e2e:agent:live` | Agentic local review | Same as `e2e:agent`, but also invokes `canvas.present` on the active OpenClaw node. |
| `pnpm run pack` | Packaging | Builds and writes `openclaw-even-g2-node.ehpk`. |
| `pnpm release:check` | CI / release gate | Runs broad release checks; release status separately reports the runtime Gateway whitelist review risk. |
| `pnpm release:bundle` | Release artifact | Creates the local release bundle directory and prints the full bundle manifest JSON. |
| `pnpm release:bundle:summary` | Release artifact | Creates the same local release bundle directory and prints compact upload-critical fields. |
| `pnpm release:status:summary` | Release status | Prints compact readiness, bundle, screenshot, and known review-risk state. |
| `pnpm release:status` | Release status | Prints the full release status JSON for detailed inspection. |
| `pnpm audit:all` | Local release audit | Runs `ci`, `release:bundle:summary`, and `release:status:summary` in sequence. |
