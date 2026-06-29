# Architecture

Last reviewed: 2026-06-27.

## Shape

OpenClaw Node for Even G2 has three pieces:

- OpenClaw Gateway: owns sessions, node pairing, audio transcription, and node
  command routing.
- Even Hub phone client: owns setup/status UI and the WebView runtime.
- Even G2 live bridge: owns the active glasses HUD, input events, microphone
  capture, and display updates while the app is connected through Even Hub.

The visible OpenClaw node name is `Even G2`. The Even Hub listing name is
`OpenClaw Node`.

## Responsibilities

OpenClaw owns:

- session routing and history;
- node pairing approval and trust;
- speech transcription provider/model/API key configuration;
- speech transcription prompt/instruction tuning;
- approval semantics;
- canvas commands;
- long-lived storage outside the Even Hub app.

The Even Hub client owns:

- selected-session log on the glasses and session selection on the phone;
- G2 microphone capture through the live Even Hub bridge;
- compact HUD rendering;
- phone setup/status UI;
- local device identity, Gateway setup settings, role-scoped device tokens, and
  last selected session.

The client opens two Gateway WebSocket sessions with the same device identity:

- `role: "node"` advertises `device`, `talk`, and `canvas` capabilities and
  handles `node.invoke` requests.
- `role: "operator"` uses the bounded setup-code/operator token path for
  session list, history, chat send/abort, approvals, and selected-session
  voice submission.

The client does not hard-code `agent:main:main` as the first session. On a
fresh install, it waits for the operator connection's
`sessionDefaults.mainSessionKey` and uses that value. In OpenClaw, `main` is the
default direct-session suffix for an agent; the agent id itself is configured
and may be something other than `main`.

The locally stored selected session is only a preferred session key. It may
disappear when the Gateway prunes sessions, the user cleans up session state, or
agent configuration changes. After `sessions.list`, the client must verify that
the stored key exists before using it. If not, it switches to an existing
session from the returned list: default-agent `main` first, then the first
user-selectable row, then the first returned row.

The client first identifies itself with OpenClaw's native Even G2 client id:
`client.id: "openclaw-even-g2-node"`, `client.platform: "even-g2"`,
`client.deviceFamily: "glasses"`, and `client.mode: "node"` or `"ui"`
depending on the WebSocket role. Gateway builds with native Even G2 bootstrap
support can then return a primary node token plus a bounded operator handoff
token from one setup-code approval.

For compatibility with public Gateway builds that do not yet know that client
id, the client falls back once to `client.id: "node-host"` when the initial
native-id connect fails with a client/schema/validation error. This preserves
connectivity at the cost of an extra operator approval on those Gateways.

## Node Surface

The node advertises:

- `device.status`
- `device.info`
- `device.permissions`
- `device.health`
- `talk.ptt.once`
- `canvas.present`
- `canvas.hide`
- `canvas.snapshot`

`talk.ptt.once` and canvas commands require a connected live Even Hub bridge to
the active glasses app. Phone backgrounding alone does not make the node
unavailable if the glasses app keeps accepting input. If the live client is
absent, the command should fail explicitly with `EVEN_G2_BRIDGE_UNAVAILABLE`.
Do not infer bridge availability only from whether the phone WebView is visible.
`device.status` exposes `bridgeLive` as the key bridge-availability signal.
The status command reaching the app already proves that the Gateway transport
and JavaScript command handler are alive; `bridgeLive` answers the separate
question of whether this WebView can still operate the active G2 app.
When available, `device.status` also includes Even Hub SDK device status
details such as battery, charging, wearing, in-case, and G2 connection state.
`device.info` describes the canvas dimensions and accepted `canvas.present`
payload forms so Gateway-side agents do not need hardcoded Even G2 display
knowledge for common text, message, notification, and inline-image updates.

## Voice Boundary

The client exposes voice enabled/disabled plus two user-facing routing modes:
`Review` and `Send now`. For `Review`, it can optionally prefer one
Gateway-reported Talk provider from `talk.catalog`. It does not expose
free-form provider names, model names, OAuth profiles, or API-key fields.

Preferred transcription path:

- Even Hub captures PCM only while the selected-session voice turn is active;
- `Review` streams PCM into OpenClaw Talk transcription while the
  user is speaking, shows live text on the glasses, and only sends final text to
  the selected session after the user taps send;
- `Send now` wraps the captured PCM as a short WAV attachment and
  sends it to the selected OpenClaw session with `chat.send`.

The attachment paths apply shared preprocessing before upload: too-short
rejection, silence rejection, leading/trailing trim, and conservative gain
correction. The review path is intentionally streaming and therefore cannot
perform whole-utterance trimming before OpenClaw sees audio.

For review mode, the client must honor the `audio` format returned by
`talk.session.create`. The current OpenAI transcription relay returns
`g711_ulaw` at 8000 Hz, so the Even G2 16000 Hz PCM input is downsampled and
encoded before `talk.session.appendAudio`.

The node does not own provider authentication, model choice, or transcription
success. It only owns routing mode, optional selection among Gateway-reported
Talk providers, capture lifecycle, preprocessing, and the realtime review
confirmation UX.

OpenClaw Talk transcription is the default review path. Provider, model, and
API key configuration remain entirely in OpenClaw.

Gateway configuration has two separate surfaces:

- Review mode depends on the OpenClaw `voice-call` plugin's streaming
  transcription config and OpenClaw Talk transcription. `talk.catalog` must list
  a transcription provider with `gateway-relay` transport and `brain: "none"`,
  but that listing is not a live auth or endpoint probe. The app treats the
  returned `audio` format from `talk.session.create` as authoritative and
  converts Even G2 PCM before streaming chunks. The provider is treated as live
  only after `talk.event` reports `ready` and transcript text is returned. xAI
  is the recommended provider when the user's OpenClaw xAI route can use
  subscription-backed access, avoiding metered STT API billing. OpenAI and other
  realtime transcription providers are alternatives when the user intentionally
  configures them; OpenAI should not be presented as the default fallback.
- Direct attachment mode depends on OpenClaw media audio
  understanding. Configure `tools.media.audio.models` with provider and/or CLI
  entries, and tune `tools.media.audio.prompt` for short glasses dictation.

The Gateway method split is documented in
[openclaw-protocol.md](openclaw-protocol.md). Keep implementation changes on
that boundary: live transcript review uses `talk.session.*`; direct audio submission
uses `chat.send` plus media-understanding.

## Session Selection Filtering

The phone session selector is a product surface, not a raw database browser.
The default view should hide sessions that OpenClaw structurally marks as
internal or synthetic. Current OpenClaw session metadata often lacks reliable
titles or previews, so the selector shows the OpenClaw session key directly
instead of generated labels.

The default filter may use stable structural signals:

- `agent:*:cron:*` keys and `kind: "cron"`;
- `agent:*:subagent:*`;
- `agent:*:node-*`;
- `agent:*:eveng2:*`;
- OpenClaw-provided metadata such as future `hasUserMessages: false`,
  `messageCounts.user: 0`, `isSynthetic`, or a first-class purpose/category.

The filter must not use prompt or transcript body strings such as `probe`,
`smoke`, `benchmark`, model names, environment names, or `reply exactly OK`.
Those strings are operator- and harness-specific and can incorrectly hide real
user sessions. If a session looks noisy only because of its text, prefer sorting
or labeling improvements over hiding it.

Media-only rows are valid user sessions. Even G2 voice input may initially
appear as `[User sent media without caption]`; the app should ignore that text
as a label candidate and prefer assistant preview or recency fallback, but must
not hide the session for that reason.

Label fallback should be minimized before using `Recent session <date time>`.
The preferred label order is user first/latest message, assistant first/latest
message, latest message preview, explicit title/label, channel display name,
and then recency fallback. Long-term, OpenClaw Gateway should expose richer
session-list metadata so the Even Hub client does less inference: stable
display names, `lastInteractionAt`, `sessionStartedAt`, `hasUserMessages`,
message counts, and synthetic/probe classification.

## Platform Comparison

OpenClaw Android and iOS nodes provide a useful pairing model: show the selected
Gateway, pairing state, live-bridge status, enabled capabilities, and permission
state. Their broader phone capability surface should not be copied into Even G2.

Even G2 should stay focused on:

- last-selected-session recent log as the first glasses view;
- session selection on the phone setup/status surface;
- selected-session voice input through OpenClaw transcription;
- approval prompts;
- OpenClaw text and inline image canvas display;
- concise replies and glanceable state.
