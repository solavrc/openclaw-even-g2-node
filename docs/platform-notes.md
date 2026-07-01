# Platform Notes

Last reviewed: 2026-06-29.

## Even Hub SDK

This repo targets `@evenrealities/even_hub_sdk` `^0.0.11`.

Useful public APIs:

- `createStartUpPageContainer`
- `rebuildPageContainer`
- `updateImageRawData`
- `textContainerUpgrade`
- `audioControl`
- `getAppLocation`
- `onEvenHubEvent`

The public SDK exposes page container rendering, G2 microphone PCM capture,
one-shot phone location, IMU control, local storage, device info, and event
callbacks. It does not expose a documented real-device framebuffer screenshot
API, built-in transcription API, Android `SpeechRecognizer` bridge, Web Speech
API bridge, or native handler registration mechanism for `.ehpk` packages. It
also does not expose a documented QR/barcode scanner API; the camera API is a
single-image capture flow through `captureImageFromCamera()`.

`getAppLocation()` reads from the phone location services and requires the
`location` app permission. This repo exposes only the one-shot `location.get`
node command for now; it does not call continuous location update APIs or keep a
background location subscription.

Only one event-capturing container should be active on a page. Create the
startup page container before microphone or IMU use.

## Display Constraints

Official display docs:

- https://hub.evenrealities.com/docs/build/display
- https://hub.evenrealities.com/docs/build/design-guidelines

The glasses render a 576x288 canvas in each eye. Containers are placed with
absolute pixel coordinates; there is no CSS, flexbox, DOM, background fill, or
z-index beyond declaration order.

Text containers are plain text, left-aligned, and top-aligned. The firmware
controls wrapping. The app cannot set font size, font family, bold, italic, or
monospace rendering. Phone-side HUD preview should therefore use the same
576x288 coordinate model and approximate the firmware's proportional LVGL font
rather than a terminal monospace font.

Even's built-in apps may show native dialogs or richer text treatments that are
not exposed as public `.ehpk` `TextContainer` controls. This app should not
depend on background-filled modal overlays, custom fonts, or arbitrary
`TextContainer`/`ImageContainer` z-order. For voice review, use a text-only
review panel that preserves session context in the header and gives the main
body area to the transcript.

The normal HUD layout uses three text containers. The top row is split into
two fixed-width regions so the scrollable body can use the bottom of the
display:

- header: `xPosition: 16`, `yPosition: 12`, `width: 260`, `height: 34`,
  `paddingLength: 0`, `isEventCapture: 0`;
- body: `xPosition: 8`, `yPosition: 50`, `width: 560`, `height: 226`,
  `paddingLength: 10`, `isEventCapture: 1`;
- hint: `xPosition: 300`, `yPosition: 12`, `width: 260`, `height: 34`,
  `paddingLength: 0`, `isEventCapture: 0`.

Only the body captures text scroll events. Header and hint are single-line
status areas; keep their padding at zero so a one-line label does not overflow
and show a misleading scrollbar. Do not add a bottom footer unless a future HUD
state has a stronger need for persistent bottom text than for scrollable body
height.

Review voice input uses a separate panel layout with three text containers. The
selected session remains visible in the header while the transcript receives the
main body area:

- header: `xPosition: 16`, `yPosition: 12`, `width: 260`, `height: 34`,
  `paddingLength: 0`, `isEventCapture: 0`;
- review panel: `xPosition: 8`, `yPosition: 50`, `width: 560`,
  `height: 226`, `paddingLength: 10`, `borderWidth: 1`,
  `isEventCapture: 1`;
- hint: `xPosition: 300`, `yPosition: 12`, `width: 260`, `height: 34`,
  `paddingLength: 0`, `isEventCapture: 0`.

The panel must look like it belongs to the selected session, not like a
separate screen. Keep the selected session in the header and use the border to
make the transcript confirmation region distinct. Keep the top-right hint short
because it shares the top row with the selected-session label. Do not rely on
text containers to mask lower-layer text; text containers draw their own text
and border, but do not provide a fill layer.

When the phone shows glasses content, treat it as a readable record of the
latest payload sent to the glasses, not a pixel-perfect clone of the firmware
renderer. Use the simulator or real G2 for layout fidelity checks.

If a future screen renders the primary UI as images instead of text, keep one
full-screen `TextContainerProperty` behind the images with `isEventCapture: 1`
and a blank content string. Image containers do not capture events, and a hidden
one-item list is not enough for scroll boundary events because there is nothing
for the firmware to scroll. Tile image containers on top of the event-capture
text container when a full 576x288 image surface is needed.

Even Hub page-lifecycle docs require the logical root page to call
`shutDownPageContainer(1)` so the system exit-confirmation dialog is shown.
This product treats the selected-session surface as the root page. Root-page
double tap should call `shutDownPageContainer(1)` and show the system exit
confirmation. Session switching is handled on the phone, not by glasses
double-tap navigation.

Do not rely on long press as an app-level gesture unless Even Hub exposes a
stable app event for it. Local testing observed reliable app-level click,
double click, up, down, and system exit events; long press is used by Even Hub
for system exit behavior and did not behave like repeated click events.

## Background Lifecycle

Official background lifecycle docs:

- https://hub.evenrealities.com/docs/build/background-lifecycle

The official page was last updated on 2026-06-22. It treats the app as a
WebView hosted by Even Hub: iOS generally keeps in-memory JavaScript state
running while backgrounded, while Android may suspend or reclaim the Chromium
WebView under memory pressure. It also says browser `localStorage` is persisted
to disk and should survive background / lock, while in-memory state,
WebSockets, and `audioControl(true)` capture may not.

Additional community notes:

- https://github.com/nickustinov/even-g2-notes/tree/main
- https://github.com/nickustinov/weather-even-g2
- https://github.com/dmyster145/EvenChess

`even-g2-notes` is a curated observation/reference repo rather than an app
source tree. Use it as an index for SDK behavior, event values, page lifecycle
constraints, and display limitations. For concrete app behavior, inspect the
linked example apps.

Storage guidance differs between sources. The official background lifecycle
page says browser `localStorage` is disk-backed and should survive ordinary
background / lock recovery, while `even-g2-notes` recommends treating Even Hub
bridge storage as the durable app store because packaged WebView browser
storage can be reset across app or glasses restarts in practice. This repo
therefore intentionally keeps both surfaces: browser `localStorage` gives
synchronous startup reads and normal WebView recovery, while
`bridge.setLocalStorage()` mirrors the same setup/session/voice state plus
device credentials for packaged-app relaunches and host-managed WebView
migration. Do not simplify this to only one storage surface without new
hardware evidence.

Treat the Even Hub WebView as the active node process for the glasses app. Do
not equate "phone app backgrounded" with "node stopped" or "glasses app no
longer interactive." Real Even Hub apps can continue accepting glasses input
while the phone app is in the OS background. The platform behavior still differs
by OS: iOS WebView state generally survives backgrounding, while Android
WebView state may be suspended or lost under memory pressure. Persist important
state eagerly, start best-effort keep-alive after bridge setup/user input, and
rebuild from storage on relaunch.

Local private-build testing on Pixel 10 with real G2 found that
`device.status` continued to report `bridgeLive: true` and `canvas.present`
still rendered while the Even app was foregrounded, shortly after OS
backgrounding, after several minutes in the background, and after several
minutes with the phone screen off. When the Even Hub app itself exits the node
app, Gateway invocation fails as `node not connected`. Treat this as
real-device evidence for the current release, not as a permanent platform
guarantee.

The `weather-even-g2` example auto-connects at launch and follows the same
split this repo uses: `FOREGROUND_EXIT` pauses its periodic refresh loop but
keeps the app initialized, while abnormal/system exit detaches event listeners.
Use that as a reference for ordinary background survival, not as a guarantee
that microphone capture or display updates remain available while the WebView is
backgrounded.

`EvenChess` is the strongest background-survival reference found so far. It
treats SDK system events as the lifecycle signal, deduplicates duplicate
foreground/background events, suspends timers on real background, resumes with a
forced display refresh, and distinguishes the native exit confirmation flow
from a real background transition. It also includes an experimental
`window.__getStateSnapshot()` / `window.__restoreState()` shim for host-managed
foreground-to-headless WebView state transfer. That API is not part of the
public Even Hub SDK docs yet, so this app treats it as best-effort recovery
only. The app installs compatible globals and snapshots only small UI/settings
state; durable setup still comes from Even Hub bridge storage.

`EvenChess` documents a critical exit-dialog quirk: after an app explicitly
calls `shutDownPageContainer(1)`, the host may emit `FOREGROUND_ENTER_EVENT`
when the native confirmation appears and `FOREGROUND_EXIT_EVENT` when the user
cancels with "No". In that narrow state, the events are not ordinary
foreground/background transitions. This repo currently does not invoke the
native root-page exit dialog from the selected-session surface, but if that
changes, track an explicit `exitDialogPending` state and branch lifecycle
handling before treating `FOREGROUND_EXIT_EVENT` as backgrounding.

Some community code also includes best-effort keep-alive helpers. `EvenChess`
uses a very quiet `AudioContext` plus the Web Locks API, and `even-toolkit`
exposes a similar `activateKeepAlive()` utility. As of `even-toolkit` 1.7.7,
that utility starts a low-gain 1 Hz `AudioContext` oscillator and requests an
indefinite Web Lock. This repo uses the same kind of best-effort keep-alive
after the Even Hub bridge is ready and retries after user/glasses input because
the product's primary surface is the glasses, not the phone. Treat keep-alive
as opportunistic: it can require a user gesture, can behave differently across
iOS/Android WebViews, and does not remove the need to persist/recover state.
It also must not be used to justify unbounded provider requests after the actual
app session has ended.

Implementation rules:

- persist the normalized Gateway URL, selected session, voice mode, preferred
  Review provider, recording limit, node identity, and device tokens scoped by
  Gateway URL and role to browser and Even Hub local storage;
- expose best-effort `window.__getStateSnapshot()` / `window.__restoreState()`
  hooks for host-managed WebView migration, but do not put Gateway tokens,
  provider credentials, audio buffers, approval payloads, or transcript history
  into that snapshot;
- start best-effort WebView keep-alive after the Even Hub bridge is ready and
  retry it after user or glasses input. The helper may use a low-gain
  `AudioContext` oscillator and a Web Lock when available, but failure must not
  block normal app startup or glasses input;
- keep the Gateway WebSocket connected when the WebView is merely backgrounded
  if the OS allows it, so ordinary node/operator traffic can continue;
- close the Gateway WebSocket on `ABNORMAL_EXIT_EVENT` and `SYSTEM_EXIT_EVENT`
  because those are app-exit signals, not ordinary background transitions;
- do not use browser `visibilitychange` or `pagehide` alone as a stop signal.
  They describe phone/WebView visibility, not whether the glasses app is still
  active. Use `pageshow` only as a best-effort resume/reconnect hint;
- cancel active microphone capture when the WebView unloads, the bridge is lost,
  or the SDK reports abnormal/system app exit;
- return to the selected-session HUD on foreground resume if voice capture was
  interrupted by an actual app teardown;
- report glasses capabilities as unavailable only when there is no live Even Hub
  bridge/client, not merely because the phone page is hidden;
- reject `talk.ptt.once` and `canvas.present` with
  `EVEN_G2_BRIDGE_UNAVAILABLE` when there is no live G2 bridge/client instead
  of pretending the glasses display or microphone is usable;
- listen for SDK `FOREGROUND_ENTER_EVENT`, `FOREGROUND_EXIT_EVENT`,
  `ABNORMAL_EXIT_EVENT`, and `SYSTEM_EXIT_EVENT`, but avoid treating
  `FOREGROUND_EXIT_EVENT` as app teardown. It can mean the phone app moved to
  the background while the glasses app remains interactive, and the native exit
  confirmation flow can also emit source-less lifecycle-like events;
- suppress duplicate identical lifecycle events that arrive within the short
  firmware echo window, while still logging the raw events for diagnostics;
- reconnect from persisted setup state if Android drops the WebSocket or cold
  starts the WebView after suspend.

Use browser `localStorage` as the first persisted WebView cache for ordinary
background / lock recovery. Keep the Even Hub bridge storage mirror as a
defensive second copy for host-managed WebView migration, packaged-app
relaunches, and cases where bridge storage is available before the browser
cache has been fully hydrated. Mirror setup/session/voice settings and device
credentials through `bridge.setLocalStorage()` and reload them through
`bridge.getLocalStorage()` after the bridge becomes available. Treat both
storage surfaces as best-effort and keep enough data in either one to rebuild
pairing and user preferences after Android suspend, host WebView migration, or a
cold relaunch.

Do not infer lifecycle state from raw `eventType` 4/5 alone. Community notes
map those values to foreground enter/exit, while local testing has also seen
source-less 4/5 events around the native exit confirmation flow, and real apps
can keep accepting glasses input after the phone goes to the OS background. The
app logs those raw events for diagnostics and uses them as lifecycle hints,
while capability availability remains based on whether the Even Hub bridge is
still present.

The beta/private test plan still needs a longer idle check with no external
Gateway invokes during the wait: start the app, pair it, lock the phone for
several minutes, avoid touching the phone/glasses/Gateway, then verify that the
selected session, Gateway connection, and canvas/talk capabilities recover
without a new setup QR.

## Audio

The SDK microphone bridge delivers PCM audio through Even Hub events. The
official ASR template leaves speech-to-text implementation to the app.

Current implementation rules:

- declare `g2-microphone` permission in `app.json`;
- start and stop capture with `audioControl`;
- stream Review-mode PCM into OpenClaw Talk while recording so transcript text
  can appear before the user sends it;
- send Send-now captures to the configured OpenClaw Gateway as short WAV
  attachments after local preprocessing;
- let OpenClaw own transcription provider configuration, model, auth profile,
  API key, and billing route;
- allow the user to prefer one Review provider only when that provider already
  appears as usable in Gateway `talk.catalog`;
- use OpenClaw `talk.session.*` for live Review and OpenClaw
  `tools.media.audio` indirectly through `chat.send` attachments for Send now;
- keep provider setup out of the Even Hub client.

## Simulator

Use the official simulator for layout and event-loop checks. Its
`/api/screenshot/glasses` endpoint returns a 576x288 RGBA PNG. The simulator
uses green rendering, so alpha values are the reliable blank-screen signal.
This repo's `pnpm sim:capture` converts that alpha channel into a black
background `reviewPath` PNG for human HUD review.

Useful automation endpoints:

- `GET /api/ping`
- `GET /api/screenshot/glasses`
- `GET /api/screenshot/webview`
- `GET /api/console`
- `POST /api/input` with `click`, `double_click`, `up`, or `down`

## Networking And Permissions

Even Hub networking has two gates:

- `app.json` `network.whitelist`;
- normal browser CORS.

Official docs describe network permission coverage for `fetch`,
`XMLHttpRequest`, and WebSocket requests. Whitelist entries should be full
origins. Bare hostnames and wildcard domains are not documented as supported.
Production builds should use HTTPS/WSS origins. Plain HTTP is local-development
only.

Server-side CORS headers and OpenClaw Gateway `controlUi.allowedOrigins` are
separate checks. Even Hub's networking docs show `Access-Control-Allow-Origin:
*` as a server CORS response example, but that does not mean the Even Hub
manifest whitelist accepts wildcards, nor does it mean OpenClaw's control UI
origin allowlist should be wildcarded. When OpenClaw reports `origin not
allowed`, add the phone-shown app origin, for example an Even Hub local WebView
origin such as `http://127.0.0.1:<port>`, to
`gateway.controlUi.allowedOrigins`.

This product's preferred architecture is direct user-owned OpenClaw Gateway
access through a secure user-managed route such as Tailnet/VPN,
Tailscale Serve/Funnel, or another `wss://` endpoint. The public-release
question is how Even Hub review wants runtime user-owned WebSocket endpoints
declared in `network.whitelist`.

Do not treat local QR/prototype mode as permission-review parity. Use private
or beta portal builds for manifest, permission, and review-path validation.

## Setup QR Capture

The preferred setup interaction is:

1. OpenClaw shows a setup QR.
2. The user taps `Scan setup QR` in the Even Hub app.
3. The app tries `navigator.mediaDevices.getUserMedia()` plus
   `BarcodeDetector`/`jsQR` for live scanning.
4. If live camera preview is unavailable, the app offers an explicit
   `Use Even Hub camera` fallback that calls `captureImageFromCamera()` and
   decodes the returned image with `jsQR`.

Pixel 10 local-testing observation on 2026-06-25: the Even Hub WebView exposed
the Even Hub bridge and SDK camera capture, but did not expose
`navigator.mediaDevices.getUserMedia`. Treat live Web camera scanning as a
best-effort path until a portal-installed private build proves otherwise.

## Non-Normative Observations

During local and community research on 2026-06-24, dynamic user-owned Gateway
endpoints and WebSocket whitelist behavior appeared to be an active platform
edge. Treat these observations as prompts for verification, not as API
guarantees:

- runtime-configured LAN/tailnet endpoints are hard to represent in a static
  package whitelist;
- `wss://` behavior should be tested with the final packaged build;
- local prototype mode can differ from portal-installed private or beta builds;
- image HUD updates are better for static content than frequently changing
  session state.
