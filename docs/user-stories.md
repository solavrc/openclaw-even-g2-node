# User Stories

Last reviewed: 2026-06-29.

This document describes the product experiences that implementation and review
should preserve. When changing copy or UI, check the full story rather than the
individual feature in isolation.

## Story 1: First Setup

The user installs `OpenClaw Node` from Even Hub and opens it on the phone. The
goal is to pair the glasses with the user's OpenClaw Gateway without turning
the phone app into a chat client.

### 1.1 First launch without Gateway setup

The glasses show the product name and the OpenClaw-side request:

```text
OpenClaw Node
Ask OpenClaw with:
"Hey Claw, show my Even G2 setup QR."
scan QR on phone
```

The phone shows setup state and keeps setup actions on the status surface:

- status: `Setup required`;
- primary action: `Scan setup QR`;
- manual fallback: setup-code input for QR scanning failures;
- no phone chat box, prompt presets, provider key fields, or model picker.

Success condition: the user knows to get a setup QR from OpenClaw and scan it
with the phone.

### 1.2 Scan Gateway setup QR

The user asks OpenClaw for the Even G2 setup QR, or runs `openclaw qr` on the
OpenClaw host and scans the QR with the phone.

Expected behavior:

- the phone accepts the QR and starts connecting to Gateway;
- the glasses show a scanned/connecting state while pairing starts;
- the app stores the Gateway URL without retaining the one-time bootstrap setup
  token in visible state or long-lived settings;
- the phone keeps manual setup as a fallback, not the primary workflow.

Success condition: setup moves from "setup required" to Gateway pairing or
connection progress without exposing setup secrets.

### 1.3 Device pairing approval required

Some Gateway builds require approving the Even G2 device identity. When that
happens, the glasses show the approval need in short, state-oriented copy. The
phone may show richer context and host-command fallback.

Expected behavior:

- glasses explain that Even G2 setup approval is required;
- phone shows the current setup status and a recovery path;
- long request IDs are not the primary thing to copy from the glasses;
- the source of truth for exact approval commands remains OpenClaw host output
  or an OpenClaw agent that can see pending requests.

Success condition: the user can approve the device request without guessing
whether the app is waiting on Gateway, QR scanning, or device trust.

### 1.4 Operator approval required

After device pairing, some Gateway paths require a second approval for the
bounded operator role used by phone status, session reads, approvals, and Talk
setup.

Expected behavior:

- glasses identify that operator approval is still needed;
- phone remains a setup/status/recovery surface;
- no phone chat workflow is introduced;
- after approval, the app can read session defaults and proceed toward the
  selected-session screen.

Success condition: the operator approval path is clear without hiding the
glasses-first workflow behind phone chat.

### 1.5 Node capability approval required

Gateway may separately require approval for node tools such as `device.status`,
`canvas.present`, `canvas.snapshot`, and `talk.ptt.once`.

Expected behavior:

- glasses identify that Even G2 node tools need approval;
- phone status and diagnostics show the node approval state when available;
- after node approval, OpenClaw can invoke Even G2 node commands;
- if operator approval is still incomplete, the node connection should remain
  useful for node commands instead of being torn down unnecessarily.

Success condition: OpenClaw can treat Even G2 as a connected node once node
approval succeeds.

### 1.6 Setup success

Once the required setup and approvals are complete, the glasses enter the
selected-session screen. On a fresh install, the selected session comes from
Gateway defaults.

Expected behavior:

- glasses show the normal selected-session view;
- phone shows paired/connected status and keeps diagnostics available;
- setup QR/bootstrap data is no longer visible in normal UI;
- the user did not need a phone chat surface.

Success condition: without using a phone chat surface, the glasses reach the
selected-session screen and the node can be used by OpenClaw.

## Story 2: Continue The Current OpenClaw Session

When the user opens `OpenClaw Node` after setup, the glasses should return to
the selected OpenClaw session so the user can resume context without taking out
the phone.

### 2.1 Open to the selected session

The first useful glasses view is the selected-session screen. On a fresh
install, the app uses the default session returned by Gateway session defaults.
After the user has selected a different session, the app returns to that last
selected session when possible.

Expected behavior:

- glasses show a selected-session HUD rather than setup, diagnostics, or phone
  controls;
- the session label is short enough for the HUD, for example `main`;
- the latest readable user or agent turn is shown;
- internal/tool-only transcript entries are skipped;
- the phone is not required for normal reading.

Success condition: the user sees the current conversation context on the
glasses after opening the app.

### 2.2 Read the latest turn

The selected-session HUD identifies the session, speaker, page, and available
voice action. A typical latest agent turn looks like:

```text
main · agent · 1/1                         tap speak

Added retry logic to the upload worker and a backoff on 429s.
```

Expected behavior:

- the header includes the selected session label and speaker;
- the page indicator is shown for long or paginated turns;
- the hint exposes the primary action, `tap speak`;
- one turn is shown at a time rather than mixing several turns into one HUD;
- long text wraps or paginates instead of being silently truncated.

Success condition: the user can read the latest useful turn and knows that tap
starts voice input.

### 2.3 Navigate older and newer context

The user can move through session history from the glasses.

Expected behavior:

- `up` moves to the previous screen of the same long turn, then to earlier
  turns;
- `down` moves toward newer screens and newer turns;
- the app keeps a stable cursor while the user is reading older history;
- when the user is not reading older history, new session content can update the
  normal latest-turn view.

Success condition: the user can review recent context from the glasses without
using the phone.

### 2.4 Preserve position while reading older history

If new session content arrives while the user is reading older history, the
glasses should not jump back to the newest turn.

Expected behavior:

- the current history cursor is preserved when transcript refreshes arrive;
- new content remains available by moving `down`;
- the user can keep reading the older turn or page they intentionally selected.

Success condition: incoming OpenClaw activity does not steal the reader's
position.

### 2.5 Return to the voice loop

From the selected-session screen, the primary interaction remains voice input.

Expected behavior:

- `tap` starts the selected voice mode;
- `double tap` uses the standard Even Hub exit confirmation rather than a phone
  chat workflow;
- the header stays anchored to the selected session so the user knows where
  voice input will go.

Success condition: the user can resume context on the glasses without taking
out the phone.

## Story 3: Switch Sessions From The Phone

Session switching is a phone-side setup/navigation task. The glasses stay
focused on the currently selected session and do not expose a session picker.

### 3.1 Show the current session on the phone

The phone `Session` card shows the selected OpenClaw session key.

Expected behavior:

- the card is labeled `Session`;
- the selected value is the OpenClaw session key, for example
  `agent:main:main`;
- the card does not expose a phone chat box, prompt presets, or `New session`
  creation flow;
- the glasses continue showing the selected-session HUD.

Success condition: the user can see which OpenClaw session the glasses are
using without leaving the glasses-first loop.

### 3.2 Refresh sessions when the selector opens

Opening or focusing the session selector refreshes the session list from
Gateway.

Expected behavior:

- the app requests the current Gateway session list when the selector is
  opened, focused, or clicked;
- invalid or internal maintenance sessions are filtered out of the default
  selector;
- if Gateway no longer returns the selected session, the app falls back to a
  valid display session, normally the main session;
- the current active session remains present in the selector even if it is
  missing from the latest Gateway list.

Success condition: the selector reflects live Gateway sessions without
requiring a separate refresh button.

### 3.3 Switch to another session

From the phone `Session` card, the user chooses another OpenClaw session key
from the selector.

Expected behavior:

- the app sends a Gateway session-switch request for the selected key;
- the active session key updates locally;
- the transcript state resets for the new session;
- the app requests the new session transcript;
- the glasses stay in the normal selected-session view and update to the new
  session context.

Success condition: users can switch sessions without losing the glasses-first
reading and voice interaction loop.

### 3.4 Keep session ownership in OpenClaw

The phone selector navigates existing OpenClaw sessions only. Session creation,
session naming, archival, and broader session management stay in OpenClaw.

Expected behavior:

- the phone does not offer `New session`;
- the phone shows OpenClaw session keys directly instead of relying on generated
  titles that may be ambiguous;
- the glasses use a short display label derived from the active session, while
  the phone remains the place to inspect exact keys.

Success condition: users can switch sessions without losing the glasses-first
workflow or creating a parallel phone-chat product.

## Story 4: Review Voice Before Sending

While reading a selected session, the user can dictate a reply from the
glasses. The default path is `Review`: record on the glasses, let OpenClaw Talk
transcribe it, then show the transcript before it is added to the selected
session.

### 4.1 Start Review recording from the selected session

From the selected-session HUD, the user taps once to start voice input. In
Review mode, the glasses enter a recording state rather than sending anything
immediately.

Expected behavior:

- the header stays anchored to the selected session, for example `main`;
- the header identifies recording and Review mode, for example
  `Recording    · main · review`;
- the hint exposes `tap stop · 2-tap cancel`;
- before transcript text is available, the recording state remains stable and
  readable;
- the phone is not required to start or manage the voice turn.

Success condition: the user knows the glasses are recording for the selected
session and can stop or cancel without touching the phone.

### 4.2 Stream microphone PCM to OpenClaw Talk

While the user speaks, the app captures Even G2 microphone PCM and streams it
to OpenClaw Talk transcription. Provider, model, prompt, API keys, and provider
auth remain owned by OpenClaw Gateway.

Expected behavior:

- the app sends microphone audio only while the user-started voice capture is
  active;
- Review mode uses OpenClaw Talk transcription rather than a phone-owned STT
  provider;
- if Gateway/provider partial transcript events arrive, the glasses may preview
  them without treating them as sent text;
- `talk.catalog` provider availability is treated as setup information, not as
  proof that live transcription has succeeded.

Success condition: voice capture is routed through OpenClaw-owned Talk
transcription without moving provider configuration into the phone app.

### 4.3 Stop recording and wait for a draft

When the user taps again, recording stops and the captured audio is finalized.
The app waits for Gateway to return the transcript draft.

Expected behavior:

- the glasses show a pending state while audio is being sent or transcribed,
  for example `2/3 Sending audio`;
- the hint is non-interactive while the app is waiting, for example `wait...`;
- no text is added to the selected session during this pending state;
- the app keeps the pending draft tied to the selected target session and an
  idempotency key.

Success condition: stopping recording does not automatically send uncertain
speech into the conversation.

### 4.4 Review the transcript before sending

When the user taps again to stop recording, the glasses show the transcript:

```text
main · ready               tap send · 2-tap discard

<transcribed text>
```

Expected behavior:

- the transcript draft is shown on the glasses before it is submitted;
- the selected-session label remains visible in the header;
- `tap` is the only send action from this draft state;
- `double tap` discards the draft;
- the phone does not add a parallel chat compose box for this flow.

Success condition: the user can verify where the text will go and what text
will be sent.

### 4.5 Send or discard the draft

If the transcript is correct, tap sends it to the selected session. If it is
wrong, double tap discards it.

Expected behavior:

- sending submits the transcript to the selected OpenClaw session;
- successful send returns the glasses to the selected-session loop;
- discard returns to the selected-session loop without adding a message;
- repeated Gateway events with the same idempotency key do not create duplicate
  sends.

Success condition: poor transcription does not automatically pollute the
selected session, and intentional sends arrive once.

### 4.6 Cancel, fail, and clean up

The user or Gateway can end a Review voice turn before a usable draft exists.

Expected behavior:

- double tap while recording cancels the active voice input;
- transcription, provider, or Gateway errors stay visible with useful recovery
  copy;
- a voice failure does not add text to the selected session;
- when recording is canceled, the bridge is lost, the WebView unloads, or the
  app exits abnormally, the app stops microphone capture and closes or cancels
  the active OpenClaw Talk session.

Success condition: voice input is fast enough for conversation, and poor
transcription or failed cleanup does not silently pollute the selected session
or leave hidden provider work running.

## Story 5: Choose Safety Or Latency

The normal mode is `Review`, but some users or environments may prioritize
lower latency. The user can choose that tradeoff from the phone while keeping
the glasses interaction focused on the selected session.

### 5.1 Keep voice settings compact

The phone `Voice input` settings expose only the choices needed for glasses
dictation.

Expected behavior:

- voice input can be enabled or disabled;
- the active routing mode can be `Review` or `Send now`;
- the recording safety limit is visible and configurable within supported
  bounds;
- the optional `Review provider` selector is shown only for Review setup;
- the settings surface provides a short setup request for the user's normal
  OpenClaw chat;
- the phone does not expose provider API keys, model pickers, OAuth profiles,
  or free-form provider names.

Success condition: the user can choose the voice tradeoff without turning the
phone into a provider configuration surface.

### 5.2 Use Review for safety-first dictation

`Review` is the default mode. It uses the Story 4 flow: stream microphone PCM
to OpenClaw Talk, show the transcript on the glasses, and send text only after
the user confirms it.

Expected behavior:

- the glasses recording header identifies Review mode, for example
  `Recording    · main · review`;
- tap stops recording and waits for a transcript draft;
- the final draft uses `tap send · 2-tap discard`;
- a poor transcript can be discarded before it reaches the selected session;
- the optional Review provider preference is chosen from Gateway
  `talk.catalog`, but live success is proven only when Talk reaches ready state
  and returns transcript text.

Success condition: users who care about transcript quality can inspect text
before the selected session is modified.

### 5.3 Use Send now for lowest app-side latency

`Send now` skips transcript review. It captures audio on the glasses, wraps the
recording as a WAV attachment, and sends it directly to the selected OpenClaw
session.

Expected behavior:

- the glasses recording header identifies Send now mode, for example
  `Recording..  · main · send`;
- the body shows `[ Send now ]` while audio is being captured;
- the hint exposes `tap send · 2-tap cancel`;
- tap finalizes the recording and submits a `chat.send` audio attachment to the
  selected session;
- successful send returns the glasses to the selected-session loop;
- the selected OpenClaw Agent and Gateway media pipeline decide how to
  understand the audio.

Success condition: users can send spoken input quickly when their selected
OpenClaw Agent can handle audio attachments.

### 5.4 Make the Send now risk explicit

Because `Send now` does not show a transcript first, it trades safety for
latency.

Expected behavior:

- `Send now` does not show a transcript draft or `tap send · 2-tap discard`
  confirmation;
- audio is attached to the selected session once the user taps send;
- poor speech capture, poor media understanding, or wrong-session selection can
  affect the selected session;
- the mode label and setup guidance make clear that this is direct audio
  submission, not Review transcription.

Success condition: the user understands that `Send now` is faster because it
avoids review, and chooses it intentionally.

### 5.5 Apply shared recording safety

Both active voice modes use the same glasses-first capture lifecycle.

Expected behavior:

- if voice input is disabled, tapping from the selected-session screen does not
  start recording;
- double tap while recording cancels capture and returns to the selected
  session without sending audio or text;
- a recording safety limit prevents microphone capture from running
  indefinitely;
- when capture is canceled, the bridge is lost, the WebView unloads, or the app
  exits abnormally, microphone capture stops and any active voice transport is
  closed;
- `Send now` applies local preprocessing before upload, including too-short
  rejection, silence rejection, trimming, and conservative gain correction.

Success condition: selecting a lower-latency mode does not remove basic
recording safety or cleanup.

### 5.6 Keep Gateway ownership of voice capability

Gateway setup differs by mode, but ownership stays in OpenClaw.

Expected behavior:

- `Review` setup asks OpenClaw to configure Talk transcription;
- `Send now` setup asks OpenClaw to support audio attachments through
  `tools.media.audio`;
- provider/model/API-key/auth choices remain in OpenClaw Gateway;
- Gateway/provider errors remain visible with mode-specific recovery copy;
- changing modes updates the glasses behavior without requiring a phone chat
  workflow.

Success condition: provider ownership remains in OpenClaw while the user can
choose between safety and latency.

## Story 6: Show OpenClaw Canvas

OpenClaw can treat the glasses as a compact canvas node. Workflows invoke
`canvas.present` on the `Even G2` node, and the app renders the requested
content on the live glasses HUD.

### 6.1 Advertise the canvas contract

OpenClaw agents should not need hardcoded Even G2 display knowledge before
using the node.

Expected behavior:

- `device.info` advertises `canvas.present`, `canvas.hide`, and
  `canvas.snapshot`;
- the response includes the 576x288 canvas size;
- the response describes supported `canvas.present` kinds and payload fields;
- the response includes the inline image size policy so agents can keep image
  payloads within the app's accepted limits.

Success condition: an OpenClaw workflow can discover how to send text, message,
notification, or inline image content to the glasses.

### 6.2 Present text canvas content

When an OpenClaw workflow invokes `canvas.present` with text-like fields, the
glasses show that content on the compact HUD surface.

Expected behavior:

- `canvas.present` accepts fields such as `title`, `text`, `markdown`, `body`,
  `content`, `message`, or `html`;
- text is rendered directly on the glasses, not only on the phone;
- the phone status can summarize the current canvas text for diagnostics;
- tapping the glasses while canvas content is visible hides the canvas and
  returns to the selected-session loop.

Success condition: OpenClaw can push readable text to the glasses and the user
can dismiss it from the glasses.

### 6.3 Present inline image canvas content

When an OpenClaw workflow invokes `canvas.present` with inline image data, the
glasses show the image scaled to the Even G2 display.

Expected behavior:

- inline `data:image/...` URLs and base64 image data are accepted when they are
  within the advertised size limit;
- remote image URLs are rejected by the app instead of fetched by the Even Hub
  package;
- Gateway or the invoking OpenClaw agent is responsible for fetching,
  generating, and inlining image data before invoking the node;
- the app scales the image to the 576x288 display and sends it through Even Hub
  image containers.

Success condition: generated visual output can appear on the glasses without
turning the client into an arbitrary remote media fetcher.

### 6.4 Present short messages and notifications

Some OpenClaw workflows need short-lived HUD updates rather than persistent
canvas content.

Expected behavior:

- `canvas.present` with `kind: "message"` or `kind: "notification"` uses the
  same node command;
- optional `ttlMs`, `durationMs`, or `timeoutMs` controls are clamped to a
  short safety range;
- after the timeout, the glasses return to the selected-session loop;
- these short-lived presentations do not require a separate phone workflow.

Success condition: OpenClaw can send compact status or notification updates to
the glasses without permanently replacing the session view.

### 6.5 Hide and inspect canvas state

OpenClaw can clear or inspect the current canvas state.

Expected behavior:

- `canvas.hide` returns the glasses to the selected-session loop;
- `canvas.snapshot` reports whether canvas content is currently visible;
- a visible snapshot includes the canvas mode, active view, and current text
  when the visible canvas is text-based;
- when no canvas is visible, `canvas.snapshot` returns `visible: false` instead
  of stale text.

Success condition: OpenClaw can verify what it last put on the glasses and can
clear it intentionally.

### 6.6 Fail clearly when no live glasses bridge exists

Canvas presentation requires a live Even Hub bridge/client because the command
operates the active glasses display.

Expected behavior:

- if no live glasses client is present, OpenClaw receives
  `EVEN_G2_BRIDGE_UNAVAILABLE` rather than silent success;
- phone backgrounding alone does not imply failure if the glasses app keeps
  accepting input;
- `device.status.bridgeLive` is the bridge-availability signal for commands
  that need the active G2 app;
- render failures from Even Hub are reported as command failures rather than
  hidden behind phone-only state.

Success condition: OpenClaw can treat Even G2 as a real node capability with
clear success, snapshot, and failure semantics.

## Story 7: Handle Approvals On The Glasses

When OpenClaw requests approval during a workflow, the glasses show the request
summary and choices. The user can decide inside the glasses-first flow instead
of switching to a phone chat surface.

### 7.1 Receive a workflow approval request

The app listens for Gateway approval request events from the bounded operator
connection.

Expected behavior:

- `eveng2.approval.request` creates a pending approval state;
- the active glasses view switches to approval;
- the current selected-session context is not replaced by a phone chat flow;
- if a request is missing display fields, the glasses still show a readable
  fallback such as `OpenClaw request`.

Success condition: a workflow approval request becomes visible on the glasses
without requiring the user to inspect the phone first.

### 7.2 Show a compact approval summary

The glasses show one approval request at a time with compact, state-oriented
copy.

Expected behavior:

- the header identifies the approval state, for example
  `■ APPROVAL · main`;
- the body shows the command or ask text when Gateway provides it;
- the body shows useful context such as `cwd` when available;
- long command text and paths are shortened for the 576x288 HUD;
- the hint is `tap allow · 2-tap deny`.

Success condition: the user can understand what OpenClaw is asking to do and
which glasses actions are available.

### 7.3 Resolve from glasses input

The primary decision path is on the glasses.

Expected behavior:

- `tap` sends an `allow-once` decision for the current pending approval;
- `double tap` sends a `deny` decision for the current pending approval;
- other input while the approval is visible keeps or rerenders the approval
  prompt instead of navigating away;
- if there is no pending approval by the time the user acts, the app returns to
  the selected-session loop rather than sending a stale decision.

Success condition: the user can approve or reject the request without taking
out the phone.

### 7.4 Wait for Gateway acknowledgement

After the user makes a decision, the glasses acknowledge the local action and
wait for Gateway to confirm or resolve the request.

Expected behavior:

- an allow decision shows an `Approved` waiting frame;
- a deny decision shows a `Rejected` waiting frame;
- both waiting frames use non-interactive copy such as `Waiting for OpenClaw.`
  and `wait...`;
- an accepted ack for the same request clears the pending approval and returns
  to the selected-session loop with an `approval sent` status;
- a resolved event for the same request clears the pending approval and returns
  to the selected-session loop with an `approval resolved` status;
- acks or resolved events for another request do not clear the current pending
  approval.

Success condition: the glasses do not pretend the request completed until
Gateway confirms the matching approval event.

### 7.5 Keep the phone as recovery, not the normal approval loop

The phone may show pending approval controls for recovery, but it should not
become the default approval workflow.

Expected behavior:

- phone approval controls, when visible, show the same request metadata;
- phone controls resolve the same pending approval with `allow-once` or `deny`;
- the phone does not add a chat box, prompt presets, or a separate approval
  conversation;
- resolving the request from phone or another OpenClaw surface updates the
  glasses when Gateway reports the matching ack or resolved event.

Success condition: the user has a recovery path without moving normal approvals
off the glasses.

### 7.6 Keep setup approvals separate

Device pairing, operator setup, and node capability approvals can happen during
setup, but they are not the same as an in-session workflow approval request.

Expected behavior:

- setup approvals remain covered by Story 1 setup/recovery states;
- runtime approval prompts use Gateway approval request events;
- node command approval readiness remains visible through setup/status
  diagnostics when Gateway reports it;
- the app does not guess pending setup request IDs from a runtime approval HUD.

Success condition: users can distinguish setup trust problems from
workflow-level approval prompts.

Success condition: approvals are integrated into the glasses-first OpenClaw
loop.

## Story 8: Recover From Pairing And Gateway Errors

When setup, Gateway connection, or pairing state fails, the app should help the
user distinguish where the failure is. The phone is the recovery and
diagnostics surface; the glasses keep short state-oriented guidance.

### 8.1 Show setup-required recovery before pairing exists

If no Gateway setup URL is stored, the app stays in setup mode rather than
trying to reconnect.

Expected behavior:

- glasses show the setup request, not a generic connection error;
- phone status is `Setup required`;
- the primary phone action is `Scan setup QR`;
- manual setup-code entry remains available as a fallback;
- `Retry now` is not shown before setup exists.

Success condition: the user knows they need a setup QR before any Gateway
recovery can happen.

### 8.2 Distinguish Gateway unreachable from Gateway-rejected

If a setup URL exists but the WebSocket connection does not complete, the app
shows that Gateway connection needs attention without treating it as stale
pairing by default.

Expected behavior:

- the original connection or WebSocket error remains visible;
- phone guidance tells the user to check Even Hub network whitelist, Gateway
  `allowedOrigins`, and Gateway reachability;
- the glasses show a short error or guidance frame rather than a phone-only
  diagnostic paragraph;
- automatic retry may continue with backoff while the setup URL remains
  configured;
- the phone shows retry timing when an automatic retry is scheduled.

Success condition: the user can tell that the app has a setup URL but cannot
complete the Gateway connection.

### 8.3 Explain origin allowlist failures

If Gateway rejects the Even Hub WebView origin, the phone reached OpenClaw but
server-side origin policy blocked the app.

Expected behavior:

- guidance title is `Allow this app origin`;
- the original `origin not allowed` or `allowedOrigins` message remains
  available;
- the phone shows the exact app origin in status or diagnostics;
- guidance tells the user to add that full origin to
  `gateway.controlUi.allowedOrigins`;
- after Gateway config is fixed, `Retry now` reconnects without requiring a new
  setup QR.

Success condition: the user can fix the Gateway origin allowlist without
mistaking it for device pairing failure.

### 8.4 Explain setup approval failures

Some failures mean Gateway was reached but trust is incomplete.

Expected behavior:

- device approval errors show `Device approval required`;
- role-upgrade or higher-role errors show `Operator approval required`;
- node tool approval errors show `Node approval required`;
- phone guidance includes host-side discovery commands such as
  `openclaw devices list` or `openclaw nodes pending`;
- glasses guidance prefers short "Ask OpenClaw with..." phrasing and does not
  make long request IDs the primary thing to copy;
- when a concrete request ID is not trustworthy or complete, the app tells the
  user to find the Even G2 request instead of rendering a truncated executable
  command.

Success condition: the user can approve the right setup, operator, or node
request without guessing which trust layer is blocking progress.

### 8.5 Pause after repeated authentication failures

For `too many failed authentication attempts`, the app explains that Gateway
was reached but repeated authentication failed and retries are temporarily
paused.

Expected behavior:

- guidance title is `OpenClaw authentication paused`;
- the original Gateway authentication error remains visible;
- automatic reconnect is paused for this state instead of hammering Gateway;
- the phone keeps `Retry now` available for a deliberate retry;
- guidance tells the user to check pending device and node approvals;
- guidance also offers reset pairing when the stored local credentials may be
  stale.

Success condition: the user understands that Gateway is reachable, but auth is
blocked or rate-limited until approvals or pairing state are corrected.

### 8.6 Retry deliberately

When setup exists and the app is not connected, the phone status surface offers
a direct retry path.

Expected behavior:

- `Retry now` clears any scheduled reconnect timer and attempts connection
  immediately;
- scheduled automatic retry shows countdown copy such as
  `Auto retry in ~Ns`;
- when the retry timer fires, the status changes to `Retrying now...`;
- retry does not clear stored pairing or setup data;
- retry is hidden when the app is already connected.

Success condition: the user can retry after fixing Gateway or approval state
without losing setup.

### 8.7 Set up again when pairing is stale

If local pairing is stale, the user can clear app-side state before scanning a
fresh setup QR.

Expected behavior:

- `Connection` -> `Set up again` clears the phone's stored Gateway setup and
  device credentials;
- app-side session, node snapshot, pending approval, and node approval state
  are reset;
- the glasses return to the setup prompt;
- local testing can also clear app-side setup with `?resetPairing=1`;
- OpenClaw-side cleanup, when needed, remains an explicit host-side action such
  as the repo's reset-pairing helper.

Success condition: the user can escape stale pairing without hidden leftover
state in the phone app.

### 8.8 Keep diagnostics available without becoming a chat client

Recovery should expose enough detail for troubleshooting while preserving the
product boundary.

Expected behavior:

- phone diagnostics include connection state, node status, node approval state,
  pending node request ID when known, app origin, app version, session key, and
  recent Even Hub events;
- node status distinguishes Gateway connectivity from G2 bridge availability;
- recovery actions stay grouped in setup, status, diagnostics, and connection
  panels;
- no phone chat box, prompt presets, provider key fields, or Gateway settings
  editor is introduced.

Success condition: the user does not have to guess whether the problem is
network reachability, Gateway reachability, device approval, node approval, or
stale pairing state.

## Review Checklist

For local review or agentic E2E, verify each story at the behavior boundary:

- Story 1: setup QR, device/operator/node approvals, selected-session entry,
  and node command availability.
- Story 2: selected-session resume, readable latest turn, history navigation,
  cursor preservation, and voice-loop return.
- Story 3: phone session key display, selector refresh, session switch, and no
  phone-owned session creation.
- Story 4: Review recording, OpenClaw Talk transcript draft, send/discard, and
  failure cleanup.
- Story 5: Review versus Send now behavior, recording limits, direct WAV
  attachment, and Gateway-owned provider setup.
- Story 6: canvas contract discovery, text/image/message presentation,
  hide/snapshot, and live-bridge failure semantics.
- Story 7: runtime approval prompt, glasses allow/deny, matching ack/resolved
  handling, and separation from setup approvals.
- Story 8: setup-required, network/origin, approval, authentication-pause,
  retry, setup-again, and diagnostics recovery states.
- Evidence: simulator or live screenshots are nonblank and readable; real G2 or
  private/beta builds cover microphone, permissions, packaged networking, and
  lifecycle behavior when those surfaces are in scope.
