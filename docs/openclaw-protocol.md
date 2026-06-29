# OpenClaw Protocol Notes

Last reviewed: 2026-06-29.

This note records how OpenClaw Node for Even G2 should use OpenClaw Gateway
protocol surfaces. It is implementation guidance for this repository, not an
OpenClaw protocol specification.

## Rule Of Thumb

Use the highest-level OpenClaw surface that matches the user experience:

- Use `talk` when the glasses need live voice interaction or live
  transcription feedback.
- Use `chat` when the app is submitting a completed user action to an OpenClaw
  session.
- Use `tools.media.audio` indirectly through `chat.send` attachments when the
  selected Agent should decide how to understand an audio file.
- Use node capabilities only for live G2 bridge features such as HUD rendering,
  canvas presentation, and push-to-talk.

Do not place provider keys, provider model choices, or billing decisions in the
Even Hub package. Those belong to OpenClaw Gateway.

## Gateway Identity And Pairing

The app opens two Gateway WebSocket roles with the same local device identity:

- node session:
  - `client.id: "openclaw-even-g2-node"`
  - `client.mode: "node"`
  - `client.platform: "even-g2"`
  - `client.deviceFamily: "glasses"`
  - `client.displayName: "Even G2"`
  - `role: "node"`
  - `scopes: []`
- operator session:
  - same `client.id`, platform, and device family;
  - `client.mode: "ui"`
  - `role: "operator"`
  - bounded scopes: `operator.approvals`, `operator.read`,
    `operator.talk.secrets`, and `operator.write`.

Gateway builds that know the native `openclaw-even-g2-node` client id can
return both a primary node token and a bounded operator handoff token from one
setup-code approval. Those handoff tokens arrive in `hello-ok.auth.deviceTokens[]`
and the app persists them by normalized Gateway URL and role so credentials
from one Gateway are not sent to another Gateway endpoint.

Gateway builds that do not know the native client id may reject the initial
connect attempt. In that case, the app falls back once to the generic
`client.id: "node-host"` identity. This preserves connectivity, but the user
may need additional approvals for the operator role or node capabilities.

If pairing needs more approvals than expected, inspect the live Gateway state
rather than assuming the app is broken:

```bash
openclaw devices list
openclaw nodes list
openclaw nodes describe --node <nodeId> --json
```

Useful fields are `clientId`, `clientMode`, `platform`, `deviceFamily`,
`approvalState`, `pendingRequestId`, `pendingDeclaredCaps`, and
`pendingDeclaredCommands`. The app also provides
`pnpm device:preview:latest` and `pnpm device:approve:latest` for local
development approval loops.

Onboarding is not a fixed wizard. The app can see connection failures and
operator events, while the user or OpenClaw Agent may see the fuller Gateway
pending state. A capable OpenClaw Agent may approve device, operator, and node
requests in one pass when the user asks it to approve the pending Even G2 setup.
The app must still handle each state independently:

- device pairing / role-upgrade failures from the WebSocket connection;
- operator approval failures from the bounded operator session;
- node command approval from `node.pair.list`, `openclaw nodes pending`, or
  `openclaw nodes describe`, not from a guaranteed WebSocket error string.

Do not rely on a Gateway error message containing `node` to detect node command
approval. Treat that as a fallback hint only.

## Review Voice Path

`Review` is a live dictation path:

1. The user taps on the glasses to start recording.
2. The app creates a Gateway-owned Talk transcription session:

   ```json
   {
     "method": "talk.session.create",
     "params": {
       "mode": "transcription",
       "transport": "gateway-relay",
       "brain": "none"
     }
   }
   ```

3. The app converts Even G2 PCM to the `audio` format returned by
   `talk.session.create`.
4. While the user is speaking, the app streams chunks with
   `talk.session.appendAudio`.
5. The app listens for `talk.event` transcript delta/final events and shows the
   transcript on the glasses.
6. When the user stops recording, the app closes the Talk transcription session
   with `talk.session.close` so Gateway can commit the final transcript.
7. If the user cancels before sending, the app calls `talk.session.cancelTurn`
   with `reason: "client-cancelled"` instead of committing the turn.
8. When the user confirms the transcript, the app sends text to the selected
   session with `chat.send`.

### Talk Abstraction Boundary

OpenClaw Node does not call OpenAI, xAI, Deepgram, or any other speech provider
directly. It calls OpenClaw Gateway's Talk RPC surface:

- `talk.catalog`
- `talk.session.create`
- `talk.session.appendAudio`
- `talk.event`
- `talk.session.close`
- `talk.session.cancelTurn`

Provider choice, provider auth, model selection, input audio format, resampling,
encoding, endpointing, VAD, commit timing, and transcript delta strategy are
Gateway/provider-plugin responsibilities.

The node can observe only:

- which providers Gateway lists in `talk.catalog.transcription.providers`;
- the `format` returned by `talk.session.create`;
- whether `talk.event` emits partial transcript events while recording;
- whether only a final transcript arrives after stop/close;
- exact provider errors surfaced by Gateway.

Do not hard-code app behavior based on provider or model names. A provider being
listed in `talk.catalog` proves that Gateway can offer that Talk path; it does
not prove that the provider will emit low-latency partial transcripts for the
current model/config. The app should display partial text when it arrives,
display the final transcript when partials do not arrive, and surface clear
Gateway setup guidance when the configured provider is missing or fails.

This path requires OpenClaw Talk realtime transcription. In current OpenClaw,
Talk streaming STT configuration is read from the `voice-call` plugin:

```text
plugins.entries["voice-call"].config.streaming
```

The selected provider plugin must also be enabled. `voice-call` selects the
streaming provider, while provider plugins such as `xai` and `openai` register
the actual realtime transcription implementations that appear in
`talk.catalog.transcription.providers`.

For this app, prefer `xai` when the user's OpenClaw xAI auth profile is
subscription-backed and the provider appears in
`talk.catalog.transcription.providers` as a configured `gateway-relay`
transcription provider with `brain: "none"`. Other realtime transcription
providers can work when the user intentionally configures them, but do not
present OpenAI as the default fallback. OpenAI realtime transcription is an
OpenAI Realtime/API path and should not be assumed to be covered by a normal
ChatGPT subscription.

`talk.catalog` is only an availability check. A provider appearing in
`talk.catalog.transcription.providers` means it is registered and configured
enough for the Gateway to offer it. It does not prove provider auth, provider
endpoint support, or live transcription success. Treat the provider as live only
after the app receives `talk.event` `ready` and transcript text. In local
testing, an OpenAI OAuth-only setup returned from `talk.session.create` but
failed before `ready` while creating the Realtime transcription client secret.

Do not enable `plugins.entries["voice-call"].config.realtime` as part of Even
G2 `Review` setup. Current OpenClaw validates `voice-call.config.streaming` and
`voice-call.config.realtime` as mutually exclusive. If the user also wants a
separate realtime conversation surface, keep that on the Talk realtime config
path instead of enabling `voice-call.realtime` alongside Even G2 Review.

## Send Now Voice Path

`Send now` is an attachment path:

1. The user taps on the glasses to start recording.
2. The app records local PCM until the user stops.
3. The app applies local preprocessing: too-short rejection, silence rejection,
   leading/trailing trim, and conservative gain normalization.
4. The app wraps the audio as WAV and sends it to the selected session with
   `chat.send` and an audio attachment.

OpenClaw then decides how the selected Agent understands the audio. In normal
Gateway setups this means the media-understanding pipeline runs
`tools.media.audio` and injects the transcript or media result into the session
context.

`Send now` is lower latency in the app because it avoids transcript
confirmation, but it can put a poor transcript or raw media interpretation into
the selected session. It is also the better path for local Whisper because
Whisper is a batch file transcription tool, not a live Talk provider.

## Avoid Batch Agent Transcription For Review

Do not implement `Review` by sending a completed audio file to a separate
Agent session, waiting for that Agent to transcribe or clean it up, then copying
the result back to the selected session. That can protect the selected session
from transcription noise, but it adds too much latency for glasses interaction
and hides progress from the wearer while they are speaking.

For this app:

- `Review` should be live Talk transcription, not batch Agent inference.
- `Send now` should submit the audio directly and let the selected Agent and
  `tools.media.audio` handle it.
- If OpenClaw later exposes a dedicated fast transcription endpoint, it can be
  considered as a third path, but it should not replace Talk for live Review.

## Canvas And Live Bridge Constraints

The node advertises `canvas.present`, `canvas.hide`, and `canvas.snapshot`.
`canvas.present` currently accepts:

- `kind: "canvas"` or no `kind`: persistent glasses canvas content;
- `kind: "message"` or `kind: "notification"`: short-lived HUD messages that
  use the same `canvas.present` command instead of requiring a separate display
  command allowlist;
- text fields such as `title`, `text`, `markdown`, `body`, `content`,
  `message`, or `html`;
- inline image fields such as `imageDataUrl`, `dataUrl`, `imageBase64`, or
  `base64`.

For `kind: "message"` and `kind: "notification"`, optional `ttlMs`,
`durationMs`, or `timeoutMs` controls how long the message stays visible. The
app clamps the value to a short safety range and then returns to the selected
session view.

Image canvas input should be inline image data. Remote image URLs are rejected
by this app because the Even Hub package should not fetch arbitrary remote
media on behalf of OpenClaw. Gateway or the invoking agent should fetch or
generate the image, convert it to an inline `data:image/...` URL or base64
payload, and then invoke `canvas.present`.

The glasses display is 576x288. The app scales image canvas payloads to fit
that display and sends the result to Even Hub as tiled image containers.

`device.info` returns the advertised commands plus the canvas dimensions,
accepted `canvas.present` kinds, supported text/image payload fields, and the
latest Even Hub device information when available. `device.status` returns the
Gateway/app state plus the latest Even Hub device status such as battery,
charging, wearing, in-case, and connection state when the SDK has reported it.

Even G2 display APIs live in the Even Hub bridge for the active glasses app.
The phone page being hidden or the Even app being in the OS background is not by
itself proof that the glasses app stopped; real apps can continue receiving
glasses input in that state. OpenClaw node commands that need the glasses
display must fail clearly when no live G2 bridge/client is connected. Use a
clear `EVEN_G2_BRIDGE_UNAVAILABLE` error rather than silently falling back to
phone-only behavior. Do not equate "phone WebView is not visible" with "the
glasses app is unavailable"; judge availability from the actual Even Hub
bridge/client state.

This is separate from voice provider selection. The Gateway owns speech
provider configuration, while the live Even Hub client owns access to the
physical microphone and HUD.
