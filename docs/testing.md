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
- `rootExit` flow: sends `double_click` on the first-run root HUD and waits
  for the `shutDownPageContainer(1)` result marker used by the native Even Hub
  exit confirmation flow;
- session-like HUD: verifies selected-session visibility. Session switching is
  owned by the phone Session selector, not by a glasses session picker.
- `sessionSelector` flow: with the dev fixture flag below, exercises the phone
  Session selector by dispatching real focus/mousedown/change events, verifies
  the app sent refresh/switch/transcript Gateway requests, then captures the
  switched glasses/phone state.

The `rootExit` flow depends on the app emitting e2e console markers. Start the
simulator against an app URL that includes `e2eLog=1`, for example
`http://127.0.0.1:35162/openclaw-even-g2-node/?resetPairing=1&e2eLog=1`.
`pnpm sim:fixtures` sets this flag automatically for its root-exit smoke.

Force a mode when needed:

```bash
EVENG2_SIM_FLOW=setup pnpm sim:e2e
EVENG2_SIM_FLOW=rootExit pnpm sim:e2e
EVENG2_SIM_FLOW=session pnpm sim:e2e
EVENG2_SIM_FLOW=sessionSelector pnpm sim:e2e
EVENG2_SIM_FLOW=voiceReview pnpm sim:e2e
EVENG2_SIM_FLOW=sendNow pnpm sim:e2e
EVENG2_SIM_FLOW=canvas pnpm sim:e2e
EVENG2_SIM_FLOW=canvasTutorial pnpm sim:e2e
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

To test the real `Send now` path against a running simulator, paired Even G2
node, OpenClaw Gateway, microphone, and a selected session that can accept audio
attachments, start the app with direct voice mode and run:

```bash
pnpm simulator 'http://127.0.0.1:5174/?resetPairing=1&e2eLog=1&e2eVoiceMode=direct' --automation-port 9898
pnpm smoke:send-now
```

The smoke starts recording from the glasses, stops after the configured record
window, waits for the app's `session-voice-sent` evidence marker, and fails if
the marker is not direct-mode evidence. This proves the app/Gateway path reached
the `chat.send` WAV attachment acknowledgement; the selected Agent's later
media understanding is still OpenClaw-owned behavior.

To run the setup smoke, Story 3 phone selector smoke, and every dev-only
fixture without manually switching simulator URLs:

```bash
pnpm sim:fixtures
```

`sim:fixtures` starts and stops the required local app servers and Even Hub
simulator processes. It builds the app first, then covers setup, root-page
double-tap exit, session
navigation, phone Session selector switching, review-before-send, Send now,
canvas, approval, and recovery fixture HUDs. For interactive fixture states it
also drives representative input events: root `double_click`, session `up`/`down`, phone selector
focus/mousedown/change, Review `tap send`, canvas `tap hide`, approval rerender
and `tap allow`, tutorial skip, and Send now cancellation. It writes
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

### Isolated Test Gateway

Do not point live E2E development at a maintainer's everyday Gateway unless the
test is explicitly checking that exact environment. Use the Docker-backed
isolated Gateway helper when collecting live OpenClaw evidence so node pairing,
Gateway auth, and transient test sessions stay out of the active `~/.openclaw`
context.

Preview the generated config and Docker command without starting anything:

```bash
pnpm e2e:gateway:plan
```

Start the isolated Gateway:

```bash
pnpm e2e:gateway:start
```

The helper writes generated state under
`.openclaw-even-g2-node/isolated-gateway/<run-id>/`. It creates a new
`state/openclaw.json` instead of copying the user's active config. The visible
base template lives at `scripts/isolated-openclaw-gateway.config.json`; the
full-story E2E template lives at
`scripts/isolated-openclaw-gateway.e2e.config.json`. The helper copies the
selected shape and applies only runtime values such as port, control origins,
and optional plugin allowlists. The default generated config is intentionally
small:

- `env.shellEnv.enabled=false` so login-shell imports do not hide missing
  requirements;
- `gateway.mode=local`, `gateway.bind=lan`, token auth via
  `OPENCLAW_GATEWAY_TOKEN`, and the container Gateway port. The Gateway listens
  on the container network so Docker port publishing works, while Docker
  publishes it only to host loopback;
- `gateway.controlUi.enabled=false` plus local dev/static origins;
- `plugins.enabled=true`, with `plugins.allow` present only when `--plugin` is
  passed;
- `tools.profile=minimal`.

The default template is enough to prove that an isolated Gateway starts and can
be probed, but it is not enough to complete all user-story E2E coverage. Full
story coverage also needs Gateway-owned voice/media configuration, setup
approval state, a connected Even G2 node, node command approvals, and selected
session evidence.

By default the Docker container receives only the generated state directory as a
writable `/home/node/.openclaw` mount. The helper may add these read-only binds
when they exist:

- `~/.openclaw/.env` to `/home/node/.openclaw/.env`;
- the auth-profile secret directory to `/home/node/.config/openclaw`;
- `~/.openclaw/agents/main/agent/openclaw-agent.sqlite*` and legacy auth JSON
  files to `/home/node/.openclaw/.seed-auth/...`.

The default `~/.openclaw/.env` bind is optional and skipped when the file is
absent. If you pass `--env-file` explicitly, the helper fails before Docker
startup when that file cannot be read.

The auth DB seed is copied into the generated writable state before Gateway
startup. This lets OpenClaw create task/session rows and fix local file modes
inside the disposable container state without mutating the user's real Gateway
context.

It does not bind the user's `~/.openclaw/openclaw.json`, active sessions, or
workspace as writable container state. The container also sets
`OPENCLAW_AUTH_STORE_READONLY=1`. Add extra read-only inputs only when a test
really needs them:

```bash
pnpm e2e:gateway:start -- --readonly-bind ~/.openclaw/credentials:/home/node/.openclaw/credentials
```

For full-story E2E coverage, use the bundled full E2E template instead of
copying the maintainer config wholesale:

```bash
pnpm e2e:gateway:start -- --full-e2e-config
```

That template adds the Gateway-owned Review and Send now requirements documented
in [gateway-voice-setup.md](gateway-voice-setup.md):

- `plugins.entries.codex.enabled=true` plus a default `main` Agent using
  `openai/gpt-5.5` through `agentRuntime.id=codex`, so the app's
  `Ask OpenClaw with:` onboarding prompt can be tested through the same Agent
  path a user would invoke;
- `plugins.entries["voice-call"].config.streaming` with xAI selected for
  OpenClaw Talk transcription;
- the `xai` provider plugin enabled, relying on read-only mounted auth/profile
  state for actual credentials;
- `tools.media.audio` with a local Whisper CLI fallback for `Send now`.

The `--full-e2e-config` preset also installs `@openclaw/codex` and
`@openclaw/voice-call` inside the container before starting Gateway. If
`openclaw qr --setup-code-only` still prints `plugin not installed: codex` or
`plugin not installed: voice-call`, inspect the container install log or
override the package with `--install-plugin <package>`.

The full template intentionally does not enable `plugins.entries.openai`; the
Agent model name remains the canonical `openai/gpt-5.5`, but execution is
forced through the bundled Codex harness. Keep the provider plugin surface
minimal unless a test proves a concrete requirement.

The full E2E template still does not prove provider auth by itself. Verify
`talk.catalog`, then prove the first Review recording reaches `talk.event`
`ready` and returns transcript text. For `Send now`, make sure the selected
session accepts audio attachments and the configured `tools.media.audio` command
is available inside the Gateway container.

If the user's OpenClaw setup uses a different Talk provider or media-audio
chain, copy the bundled JSON to a local ignored path and pass it explicitly:

```bash
pnpm e2e:gateway:start -- --config-template /path/to/openclaw-even-g2-node-e2e.json
```

`start` prints `containerName`, `hostGatewayUrl`, `containerGatewayUrl`,
`token`, an `approvalCommand`, an `e2eOnboardingCommand`, an
`e2eAgentCommand`, and a setup-code result.
Before pairing the app, prove that the onboarding instruction itself is usable
through the isolated Agent:

```bash
pnpm e2e:agent:onboarding -- \
  --openclaw-container <containerName> \
  --gateway-url <hostGatewayUrl>
```

The smoke sends the exact setup request generated by `setupHudFrame()` and
writes `.openclaw-even-g2-node/onboarding-agent-runs/<run-id>/evidence.json`.
It fails if the Agent command does not complete or if the response does not
give actionable OpenClaw/Even G2 setup QR guidance. When `--gateway-url` is
provided, it also fails if the response drops the host-reachable Gateway URL or
exposes a Docker bridge address that the phone cannot reach.

Then use the setup code with the app/simulator. Use the printed approval
command for isolated Gateway runs; it grants only the generated disposable state
enough operator/admin scope to approve setup requests, then watches for Even G2
device/operator/node approvals before the bootstrap token expires:

```bash
pnpm dev
pnpm simulator 'http://127.0.0.1:5174/?resetPairing=1&e2eLog=1&setupCode=<setup-code>' \
  --automation-port 9898
pnpm device:approve:latest -- \
  --openclaw-container <containerName> \
  --e2e-isolated-state-dir .openclaw-even-g2-node/isolated-gateway/<run-id>/state \
  --watch-ms 45000 \
  --settle-ms 8000
pnpm e2e:agent:live -- \
  --node auto \
  --openclaw-container <containerName> \
  --openclaw-url <containerGatewayUrl> \
  --openclaw-token <token>
```

`--e2e-isolated-state-dir` is intentionally limited to generated isolated
Gateway state. Do not point it at a real user Gateway state directory.

Stop the isolated Gateway when the run is finished:

```bash
pnpm e2e:gateway:stop
```

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
- simulator console logs and structured glass/session/voice/approval state
  markers when available;
- OpenClaw `nodes status` and `canvas.snapshot` command evidence when the
  local `openclaw` CLI can reach the active Gateway;
- `review-prompt.md`, which tells the Coding Agent how to judge the run;
- `llm-review.schema.md`, which fixes the expected fuzzy-review shape and
  verdict meanings;
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

For live runs against an already-running local Gateway, start the app and
simulator, pair and approve the Even G2 node, then use `--node auto` or pass a
specific connected `nodeId` to the evidence command:

```bash
pnpm dev
pnpm simulator 'http://127.0.0.1:5174/?resetPairing=1&e2eLog=1&setupCode=<setup-code>' \
  --automation-port 9898
pnpm device:approve:latest -- --watch-ms 45000
openclaw nodes status --json
pnpm e2e:agent:live -- \
  --simulator-url http://127.0.0.1:9898 \
  --node auto \
  --canvas-text "E2E canvas check"
```

The E2E bundle records the OpenClaw profile, URL, and whether a token was
provided. Token values are redacted from command evidence and manifests.

The intended reviewer is the Coding Agent itself, a separate Codex session, or
an OpenClaw-routed agent. The reviewer should return `pass`, `warn`, `fail`, or
`inconclusive` per story. It should treat missing evidence as inconclusive,
judge semantic user-story fit rather than exact wording, and fail regressions
where the phone becomes the primary chat surface or provider/Gateway ownership
moves into the app.

After writing `llm-review.json`, validate the shape before treating it as
review evidence:

```bash
pnpm e2e:agent:review:validate -- .openclaw-even-g2-node/e2e-agent-runs/<run-id>
```

The validator requires exactly one review for each `story-1` through `story-8`,
exactly one coverage entry for each numbered substory such as `story-1.1` and
`story-8.8`, confidence values from `0` to `1`, string arrays for
evidence/concerns/fixes, and one of `pass`, `warn`, `fail`, or `inconclusive`
for every verdict. Coverage entries use `observed`, `partial`, `unobserved`, or
`not-applicable`. Use `warn` when observed behavior looks aligned but the
evidence scope is incomplete; reserve `fail` for observed behavior that
contradicts `docs/user-stories.md`.

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

To cover Story 3's phone selector path locally:

```bash
pnpm simulator 'http://127.0.0.1:5174/?resetPairing=1&simFixture=session&simSessionSelectorFlow=1' --automation-port 9898
EVENG2_SIM_FLOW=sessionSelector pnpm sim:e2e
```

Replace `session` with `voiceReview`, `sendNow`, `canvas`, `canvasTutorial`,
`approval`, `recovery`, `storeChat`, or `storeVoice` to run a visual smoke against those
fixture states. The
non-session fixture flows capture the HUD and phone WebView and verify that the
rendered output is visible; the `session` flow verifies selected-session HUD
visibility.

`simFixture` is available only in Vite development mode. It seeds small public
sample states so HUD behavior can be tested without private OpenClaw state:

- `simFixture=session`: selected-session view;
- `simFixture=voiceReview`: review-before-send transcript screen;
- `simFixture=sendNow`: direct Send now recording screen;
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
http://127.0.0.1:5174/?resetPairing=1&simFixture=sendNow&openPanel=voice
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

- Portal private build install: checks manifest enforcement, install UI,
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
| `pnpm e2e:agent:review:validate` | Agentic local review | Validates `llm-review.json` against the required fuzzy-review schema. |
| `pnpm e2e:gateway:plan` | Agentic local review support | Writes the minimal isolated Gateway config and prints Docker/E2E commands without starting Docker. |
| `pnpm e2e:gateway:start` | Agentic local review support | Starts the Docker-backed isolated OpenClaw Gateway with generated state and read-only auth inputs. |
| `pnpm e2e:gateway:stop` | Agentic local review support | Stops isolated Gateway containers created by the helper. |
| `pnpm run pack` | Packaging | Builds and writes `openclaw-even-g2-node.ehpk`. |
| `pnpm release:check` | CI / release gate | Runs broad release checks; release status separately reports the runtime Gateway whitelist review risk. |
| `pnpm release:bundle` | Release artifact | Creates the local release bundle directory and prints the full bundle manifest JSON. |
| `pnpm release:bundle:summary` | Release artifact | Creates the same local release bundle directory and prints compact upload-critical fields. |
| `pnpm release:status:summary` | Release status | Prints compact readiness, bundle, screenshot, and known review-risk state. |
| `pnpm release:status` | Release status | Prints the full release status JSON for detailed inspection. |
| `pnpm audit:all` | Local release audit | Runs `ci`, `release:bundle:summary`, and `release:status:summary` in sequence. |
