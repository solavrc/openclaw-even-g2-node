# User Guide

Last reviewed: 2026-06-30.

## What This Node Does

OpenClaw Node turns Even G2 glasses into a compact OpenClaw node.

Use it to:

- choose an existing OpenClaw session from the glasses,
- read the selected session log from the latest content,
- dictate input through OpenClaw-owned speech transcription,
- receive short OpenClaw responses on the HUD,
- review approval prompts,
- show OpenClaw text or image canvas updates on the glasses.

The phone screen is for setup, session selection, connection status, and
advanced diagnostics during troubleshooting. The normal reading and voice loop
happens on the glasses.

## First Run

The first run has three phases:

1. Scan the OpenClaw Gateway setup QR from the phone.
2. Approve the Even G2 requests on the OpenClaw host when asked.
3. Start from the selected `main` session on the glasses.

1. Install the Even Hub package.
2. Open `OpenClaw Node` in Even Hub.
3. Ask OpenClaw to show the setup QR, or run `openclaw qr` on the OpenClaw
   host. Then tap `Scan setup QR` and use the Even Hub camera to capture it.
   Some Even Hub WebViews do not expose an in-app live camera preview; the
   native Even Hub camera flow is the reliable path. The app's `Ask OpenClaw`
   prompts include `solavrc/openclaw-even-g2-node` so the user's normal
   OpenClaw Agent can use this repository's setup notes when helping.
4. Approve the first pending OpenClaw device pairing request:
   `openclaw devices list`, then `openclaw devices approve <requestId>`.
   Gateways that know the native Even G2 client id normally approve the node
   role and hand off the bounded operator token in one step.
5. If OpenClaw asks for a second device approval, it is the bounded operator
   request that lets the app read sessions and send voice input. Use
   `openclaw devices list` to find the new pending request. This can happen on
   Gateway builds where the native Even G2 bootstrap client id is not available
   yet and the app falls back to the generic node-host identity.
6. Approve the pending `Even G2` node commands when Gateway reports a pending
   node approval: `openclaw nodes pending`, then
   `openclaw nodes approve <requestId>`. This lets OpenClaw invoke node tools
   such as `canvas.present`, `location.get`, and `talk.ptt.once`. It is not
   always surfaced as a WebSocket connection error, and the app intentionally
   does not display a concrete node approval request ID. Use
   `openclaw nodes pending` or
   `openclaw nodes describe --node "Even G2" --json` on the OpenClaw host when
   canvas or other node commands are unavailable.
7. Use the selected OpenClaw session on the glasses. Choose a different session
   from the phone's `Session` selector when needed.

The OpenClaw node name is `Even G2`. The Even Hub listing name is
`OpenClaw Node`.

| Where it appears | Name |
| --- | --- |
| Even Hub app listing | `OpenClaw Node` |
| OpenClaw node/device surfaces | `Even G2` |

The first setup HUD starts with the product name and a short request the user
can say or type into their normal OpenClaw session:

```text
OpenClaw Node
Ask OpenClaw with:
"Hey Claw, show my Even G2 setup QR. See solavrc/openclaw-even-g2-node."
scan QR on phone
```

During pairing, the phone status card can show concrete device/operator request
IDs when Gateway returns them in connection errors. Node command approval is
different: the app treats concrete node approval request IDs as host/OpenClaw
Agent state and shows the `openclaw nodes pending` discovery path instead. The
glasses keep the prompt short: they show the required approval step and a
conversational request the user can say or type into their normal OpenClaw
session. Some OpenClaw setups skip one of these approval requests, so the app
names the required action instead of presenting a fixed numbered wizard.

The onboarding flow is condition-based:

| App state | Condition | What the user does next |
| --- | --- | --- |
| Setup required | No Gateway setup code is stored on this phone. | Ask OpenClaw for the Even G2 setup QR, or run `openclaw qr`, then scan it. |
| Device approval required | The setup QR was scanned, but Gateway has not yet trusted the Even G2 device/node identity. This usually appears as a device pairing request. | Approve the Even G2 device request with `openclaw devices list` and `openclaw devices approve <requestId>`, or ask OpenClaw to approve the pending Even G2 setup. |
| Operator approval required | The device/node identity is trusted, but the bounded operator token is not yet approved. This can appear as a role-upgrade or higher-role request. | Approve the second Even G2 device request. This is the request that lets the phone read sessions and send voice input. If OpenClaw can see multiple pending Even G2 requests, it may approve them in one pass. |
| Node approval required | The device and operator can be connected, but Gateway still has a pending node command approval. The concrete request ID is intentionally not read from the phone app; find it through `openclaw nodes pending`, `openclaw nodes describe`, or OpenClaw Agent on the host. | Approve the Even G2 node request so OpenClaw can invoke commands such as `canvas.present`, `device.status`, `location.get`, and `talk.ptt.once`. If OpenClaw can see the full pending state, it may approve remaining Even G2 device/operator/node requests together. |
| Canvas tutorial | Node command approval just became available and the canvas tutorial has not completed yet. | Ask OpenClaw to create a tiny visual surprise for the Even G2 glasses. The tutorial completes when the app receives a real `canvas.present` command. Tap on the glasses skips it. |
| Origin blocked | The phone reached Gateway, but the WebView Origin is not allowed by `gateway.controlUi.allowedOrigins`. | Add the App origin shown on the phone to Gateway config, restart or reload Gateway if needed, then tap `Retry now`. |
| Gateway unreachable | The setup code was accepted, but this phone could not complete the Gateway WebSocket connection. | Confirm the Gateway URL is reachable from this phone network. Use a secure WSS route for remote access; plain WS should be local development only. |
| Even Hub network permission likely blocked | The Gateway URL works from the phone outside Even Hub, but the packaged app is blocked before Gateway answers. | Capture `Advanced diagnostics` and check the Even Hub network permission for that origin. |
| Ready | The operator session is connected and the app can read the selected session. | Use the glasses. Use the phone `Session` selector to switch sessions. |

The app should not assume these states always appear in the same order. Newer
Gateways may skip the second device approval. Older or generic bootstrap paths
may require it. Node command approval can remain pending even when session
reading and voice input already work.

Phone example:

```text
Device approval required:
First, trust the Even G2 device identity. A second operator approval may follow.
Run on OpenClaw host:
$ openclaw devices list
$ openclaw devices approve <current requestId>

Or ask OpenClaw:
"Hey Claw, approve my pending Even G2 setup. See solavrc/openclaw-even-g2-node."
```

Glasses example:

```text
Device approval required:
Ask OpenClaw with:
"Hey Claw, approve my pending Even G2 setup. See solavrc/openclaw-even-g2-node."
```

If a second device request appears, the app labels it as an operator approval:

```text
Operator approval required:
Ask OpenClaw with:
"Hey Claw, approve remaining Even G2 operator requests. See solavrc/openclaw-even-g2-node."
```

If OpenClaw asks for node command approval:

```text
Node approval required:
Run on OpenClaw host:
$ openclaw nodes pending
Find the Even G2 request, then run openclaw nodes approve <requestId>

Ask OpenClaw with:
"Hey Claw, approve remaining Even G2 node tools. See solavrc/openclaw-even-g2-node."
```

After running `openclaw nodes approve <requestId>`, the Gateway may not push the
updated node state to the phone immediately. If the phone still shows
`Node approval required`, tap `Check again` in the node status card. This
refreshes Gateway state without clearing pairing or scanning a new setup QR.

## Reset Pairing

If pairing gets into an unclear state during development:

1. Close the Even Hub app or simulator tab so it does not reconnect
   immediately.
2. Reset the phone-side state from `Connection` -> `Set up again`, or open the
   app with `?resetPairing=1` during local testing.
3. Reset the OpenClaw-side state from the repo:
   `pnpm dev:reset-pairing`.
4. Start again from `openclaw qr`.

For local browser or simulator testing, opening the app with `?resetPairing=1`
also clears the stored Gateway setup on the app side.

If the app shows `too many failed authentication attempts`, the phone reached
the OpenClaw Gateway but repeated authentication failed and the Gateway is
temporarily rejecting retries. The phone shows the next automatic retry
countdown when available and keeps a `Retry now` button in the node status
card. Check pending requests on the OpenClaw host with `openclaw devices list`
and `openclaw nodes pending`, then approve pending Even G2 requests, tap
`Retry now`, or use `Connection` -> `Set up again` to clear local pairing and
scan a fresh setup QR.

`Retry now` is for reconnecting when the Gateway is disconnected or auth is
paused. `Check again` is for refreshing already-connected setup state after a
node approval command has been run on the OpenClaw host.

If the app shows `origin not allowed`, the phone reached OpenClaw but the
Gateway rejected the browser Origin sent by the Even Hub app. The node status
card shows the required `App origin` value. The same value is also available in
`Advanced diagnostics`. Allow that full origin in OpenClaw
`gateway.controlUi.allowedOrigins`, then tap `Retry now`.

`Advanced diagnostics` shows the app `Version`. Check this row during private
or beta installs to confirm Even Hub is running the newly uploaded `.ehpk`, not
a cached older build.
Advanced diagnostics is mainly for bug reports, support, and release-candidate
checks. Normal users should not need it during everyday use.

## Selected Session

The first glasses view is the selected OpenClaw session. On a fresh install,
that session is the default OpenClaw agent's `main` session. After you choose
another session, the app stores that choice locally and opens it first on the
next launch.

The selected-session view shows:

- one user or agent turn from the selected session,
- a compact speaker header such as `User | Tap to speak`, `Agent | Tap to speak`, or `Agent (2/5) | Tap to speak`,
- no persistent footer while reading transcript text.

Controls:

- `up` / `down`: scroll inside the current text screen; at the top or bottom,
  move to the previous or next session-log screen
- `tap`: start voice input; tap again to finish recording. In review mode, tap
  once more to send the shown transcript.
- `double tap`: use the standard Even Hub exit confirmation from the root page.

During voice input, the glasses keep the selected session name in the header.
`Review` shows the live transcript and final confirmation as a session-anchored
voice panel. `Send now` shows a recording panel while capturing audio, then
returns to the selected-session log after the audio is sent.

The first selected-session view opens at the latest turn. If a long turn does
not fit in one text container, it is split into numbered screens. New session
content is shown automatically only when you are already at the latest screen;
while reading older history, the app does not move your position.

## Session Selection

Session switching lives on the phone. The glasses stay focused on the currently
selected session so reading and dictation do not depend on a low-information HUD
list.

The phone `Session` card shows the selected OpenClaw session key and a selector
containing user-facing sessions returned by Gateway. Change the selector to
switch the glasses to another session. The app refreshes the session list when
the selector is opened.

The selector intentionally uses the OpenClaw session key instead of generated
titles. Current OpenClaw session metadata often lacks reliable user-facing
titles or previews; showing the actual key is more predictable on the phone
than rendering ambiguous `Untitled` rows on the glasses.

Internal OpenClaw sessions such as node heartbeats, scheduled jobs, and
background maintenance sessions remain filtered out of the default selector.
Voice-input sessions remain selectable even when their initial OpenClaw message
is a media attachment without a text caption.

## Voice Input

Voice input is captured by the Even Hub client and sent to the configured
OpenClaw Gateway. Provider, model, API key, and transcription prompt selection
stay inside OpenClaw.

The package does not embed speech provider API keys. OpenClaw can route
transcription through its configured audio understanding pipeline.
For `Review`, the phone can optionally prefer one provider that OpenClaw already
lists in `talk.catalog`; this is only a provider preference, not provider
configuration.

From a selected session, tap the glasses once to start speaking. Tap again to
finish. While recording, double-tap cancels capture, cancels the active
OpenClaw Talk turn when Review is streaming, and returns to the selected session
without sending audio or text.

The phone settings expose voice enabled/disabled plus two active routing modes:

| Mode | What happens | Best for |
| --- | --- | --- |
| `Review` | Streams PCM into OpenClaw Talk transcription while the user is speaking. The glasses show live transcript text when Gateway emits partials, then show a send/discard confirmation for the final transcript. | Safety-first dictation when the user wants to read text before sending. |
| `Send now` | Sends the captured WAV directly to the selected OpenClaw session as an audio attachment after a brief recording overlay. | Lowest-latency capture when the selected OpenClaw Agent can handle audio. |

When `Review` is selected and OpenClaw is connected, `Review provider` can be
left as `Gateway default` or set to one of the Gateway-reported Talk providers.
If a saved provider later disappears or its auth expires, the app shows a
Gateway recovery message instead of silently switching to a different provider.
If `Gateway default` is selected, the app uses the first provider OpenClaw
actually lists as usable in `talk.catalog`; it does not trust
`transcription.activeProvider` by itself.

`Review provider listed` means Gateway reports a usable Talk transcription
provider. It does not guarantee that the provider/model will emit live partial
text during recording. Some Gateway/provider configurations may return only the
final transcript after the user stops. The app displays partial text whenever
OpenClaw sends it and otherwise waits for the final transcript.

Treat voice as a post-pairing verification step, not a blocker for the first
selected-session screen. After `Review provider listed`, make one short Review
recording from the glasses. Review is verified when OpenClaw returns transcript
text and the glasses show the send/discard confirmation. If that first recording
fails, keep the exact Gateway/provider error visible and repair Gateway voice
setup instead of moving provider credentials into the Even Hub app.

If voice input is disabled, selected-session taps do not start recording.

Gateway setup differs by routing mode. For a concise setup note that can be
given to OpenClaw, see [gateway-voice-setup.md](gateway-voice-setup.md).

- `Review` needs the OpenClaw `voice-call` plugin and OpenClaw
  Talk transcription.
- `Send now` needs OpenClaw media audio understanding through
  `tools.media.audio`.

If setup needs attention, the app shows a mode-specific short request that can
be sent to the user's usual OpenClaw chat:

```text
Set up OpenClaw Even G2 Review voice. See solavrc/openclaw-even-g2-node.
Set up OpenClaw Even G2 Send now voice. See solavrc/openclaw-even-g2-node.
```

Review mode streams microphone PCM while the user is speaking, so it relies on
OpenClaw Talk to decide whether speech was usable. Send now applies a
lightweight preprocessing layer before upload: very short captures are ignored,
silent captures are rejected, leading/trailing silence is trimmed, and small
gain correction is applied.

User-started voice capture has a client-side safety limit. The default is
60 seconds, and it can be changed in `Voice input` settings up to 10 minutes.
When the phone page is closed or unloaded, the app stops the microphone and
cancels or closes any active OpenClaw voice transport according to whether the
capture was still in progress or already being finalized.

OpenClaw can also start push-to-talk capture through the live `Even G2` bridge.

## Location

OpenClaw can request a one-shot phone location fix through the `Even G2` node
with `location.get`. The command uses the Even Hub bridge and the host phone's
location services; it does not use a glasses-side GPS sensor and does not start
continuous background tracking.

`location.get` requires the Even Hub `location` permission and a live bridge.
If the user denies permission, the phone has no fix before timeout, or the
runtime does not expose the location API, OpenClaw receives an explicit node
command error instead of stale cached coordinates.

## Background And Lock Behavior

OpenClaw Node is designed as a node, so ordinary Gateway connection state is
not intentionally torn down just because the phone app backgrounds. If the OS
keeps the Even Hub WebView alive, the Gateway WebSocket can remain connected
and the app can resume without a fresh setup QR.

The important boundary is the live Even Hub bridge to the active glasses app,
not whether the phone screen is currently showing this page. If the phone app
is backgrounded or locked but the glasses still show and accept input from
OpenClaw Node, voice capture, canvas presentation, and push-to-talk can
continue through that bridge. The app starts a best-effort keep-alive helper
after the bridge is ready and retries it after user or glasses input so Android
is less likely to suspend the WebView.

If the WebView is unloaded, the bridge is lost, or Even Hub reports an
abnormal/system exit during voice capture, the app stops the microphone, closes
the active voice transport, and returns to the selected session on the next
resume. It does not leave transcription or paid provider requests running after
the actual app session ends.

Android WebView may suspend or reclaim in-memory state while backgrounded. The
app stores pairing, selected session, and voice settings locally so it can
reconnect from the saved setup when foregrounded again.

## Canvas And Approvals

OpenClaw can send text or inline image canvas updates to the `Even G2` node.
Text is shown directly on the glasses HUD. Image canvas updates are accepted as
inline `data:image/...` URLs or base64 image data and are rendered to the
576x288 glasses display. OpenClaw agents can inspect `device.info` for the
current inline image size limit before sending generated image data.
Short-lived message and notification presentations use the same
`canvas.present` command with `kind: "message"` or `kind: "notification"`.

When OpenClaw requests an approval, the glasses show the request. The phone can
also show pending request controls for recovery, but the normal approval flow is
on the glasses.

## Phone Screen

The phone screen intentionally avoids becoming the primary product surface. It
shows:

- a readiness checklist for setup, Gateway route, approvals, selected session,
  live G2 bridge, and voice verification,
- connection state,
- glass pairing state,
- current session,
- current glass view,
- latest content sent to the glasses,
- collapsed advanced diagnostics for setup, Gateway, or input troubleshooting.

The phone keeps setup and recovery controls visible. `Scan setup QR` uses the
Even Hub camera flow when live preview is unavailable in the WebView. Manual
setup-code entry is only a last-resort fallback.

Readiness remains visible after first onboarding completes because the same
checks can need repair later: Gateway reachability, node tool approval, G2
bridge availability, selected session, and voice verification can all regress
independently. The top `Node` card stays intentionally compact: it shows the
overall state and one primary next action, while detailed facts live in the
readiness checklist and diagnostics.
