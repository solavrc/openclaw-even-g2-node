# OpenClaw Node

## Even Hub Store Description

OpenClaw Node connects G2 glasses to your private OpenClaw Gateway.

Use the glasses to pick an OpenClaw session, read recent context, dictate a
message, review transcript text before sending, approve requests, and receive
OpenClaw canvas text or image updates.

The core idea is simple: keep OpenClaw ambient and glanceable. The glasses
become the session, voice, approval, and canvas surface. The phone stays focused
on setup, connection status, HUD preview, voice mode selection, recovery, and
diagnostics.

Voice input is routed through OpenClaw. Speech provider, model, subscription,
OAuth, API key, transcription prompt, and media-understanding choices stay in
your Gateway configuration instead of inside the glasses app.

Configuration examples and setup references:

- Review voice:
  https://github.com/solavrc/openclaw-even-g2-node/blob/main/docs/gateway-voice-setup.md#review-mode
- Send now voice:
  https://github.com/solavrc/openclaw-even-g2-node/blob/main/docs/gateway-voice-setup.md#send-now-mode
- First-run setup:
  https://github.com/solavrc/openclaw-even-g2-node/blob/main/docs/user-guide.md#first-run

Learn more:
https://github.com/solavrc/openclaw-even-g2-node

## What This README Is For

This README is written for the end user and for the OpenClaw Agent or operator
helping that user finish setup.

| Surface | Name |
| --- | --- |
| Even Hub app listing | `OpenClaw Node` |
| OpenClaw node/device surfaces | `Even G2` |
| Repository and package namespace | `openclaw-even-g2-node` |

## First Thing To Say To OpenClaw

When the app is not paired yet, the glasses tell you to ask OpenClaw for the
setup QR:

```text
Ask OpenClaw with:
"Hey Claw, show my Even G2 setup QR. See solavrc/openclaw-even-g2-node."
```

Say or type that in your normal OpenClaw session. If you are the Agent helping
the user, use this repository as the setup reference, show a fresh Gateway setup
QR, and be ready to approve the pending Even G2 device/operator/node requests.

The command-line fallback on the OpenClaw Gateway host is:

```bash
openclaw qr
```

## Before You Start

You need:

- Even G2 glasses paired with Even Hub.
- `OpenClaw Node` installed in Even Hub, either from the listing or a private or
  beta `.ehpk` build.
- A running OpenClaw Gateway that the phone can reach.
- Permission to approve pending OpenClaw device, operator, and node-tool
  requests on the Gateway host, or an OpenClaw Agent that can do it for you.
- For `Review` voice mode, OpenClaw Talk transcription configured through the
  Gateway. For `Send now`, OpenClaw media audio understanding configured for the
  selected session.

OpenClaw owns provider, model, API-key, OAuth, subscription, prompt, and
transcription configuration. Do not put provider credentials into the Even Hub
app.

For remote Gateway access, prefer a secure `wss://` route. Plain `ws://` is for
local development or a trusted local network. If the phone says the App origin
is blocked, add the full origin shown on the phone to
`gateway.controlUi.allowedOrigins`, then retry.

## First Run

1. Open `OpenClaw Node` in Even Hub.
2. Tap `Scan setup QR` on the phone.
3. Ask OpenClaw for the Even G2 setup QR, or run `openclaw qr` on the Gateway
   host.
4. Scan the QR with the Even Hub camera flow. If camera scanning fails, use the
   manual setup-code fallback in the phone app.
5. Approve the pending Even G2 setup requests when OpenClaw asks.
6. Wait for the glasses to enter the selected-session view. On a fresh install,
   this is the Gateway default `main` session.
7. Use the glasses. Tap starts voice input; the phone `Session` selector can
   switch which OpenClaw session the glasses read and send to.

Some Gateways approve the device and bounded operator role in one step. Others
ask twice. Node tool approval can also be separate, even after session reading
already works.

## Approval Runbook

If OpenClaw or the phone says device approval is required:

```bash
openclaw devices list
openclaw devices approve <requestId>
```

If another Even G2 request appears after device approval, approve it too. That
second request is usually the bounded operator role used for session reads,
status, approvals, and voice submission.

If OpenClaw or the phone says node tools need approval:

```bash
openclaw nodes pending
openclaw nodes approve <requestId>
```

Node tool approval lets OpenClaw invoke Even G2 commands such as
`canvas.present`, `device.status`, and `talk.ptt.once`. If the phone still shows
`Node approval required` after approval, tap `Check again`.

Useful requests to give your OpenClaw Agent:

```text
Hey Claw, approve my pending Even G2 setup. See solavrc/openclaw-even-g2-node.
Hey Claw, approve remaining Even G2 operator requests. See solavrc/openclaw-even-g2-node.
Hey Claw, approve remaining Even G2 node tools. See solavrc/openclaw-even-g2-node.
```

## Voice Setup

The app has two voice modes:

| Mode | What happens | Use when |
| --- | --- | --- |
| `Review` | Streams Even G2 microphone audio to OpenClaw Talk, shows transcript text on the glasses, then sends only after confirmation. | You want to read before sending. This is the recommended mode. |
| `Send now` | Records a short WAV and sends it directly to the selected OpenClaw session as an audio attachment. | You want the fastest path and your Agent can handle audio. |

To set up voice, send one of these to OpenClaw:

```text
Set up OpenClaw Even G2 Review voice. See solavrc/openclaw-even-g2-node.
Set up OpenClaw Even G2 Send now voice. See solavrc/openclaw-even-g2-node.
```

For the best `Review` experience today, start with xAI.
[xAI's OpenClaw integration](https://x.com/xai/status/2056826183745253663)
supports SuperGrok and X Premium subscription access, so many users can turn on
glasses transcription without introducing a separate speech API account. In
practice, xAI gives `Review` the product feel this app is built around: quick
enough for short G2 voice turns, accurate enough to read before sending, and
still routed through the user's private OpenClaw Gateway.

`Review` transcription is separate from the Agent model you use for the
session. Operators can keep a Codex/OpenAI harness for the main agent while
using xAI only for the glasses transcription path. If your Gateway build hits
the known OpenAI/xAI provider-resolution conflict, follow
[openclaw/openclaw#97738](https://github.com/openclaw/openclaw/issues/97738)
or use an OpenClaw build that includes the linked Voice Call provider-resolution
fix before relying on xAI in daily use.

For `Review`, the Agent or operator should verify that `talk.catalog` lists a
usable Gateway-relay transcription provider:

```bash
openclaw gateway call talk.catalog --json
```

`Review` depends on the OpenClaw `voice-call` plugin streaming transcription
configuration. `Send now` depends on OpenClaw `tools.media.audio`. See
[Gateway Voice Setup](docs/gateway-voice-setup.md) before changing Gateway
config.

Minimal config examples for `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "voice-call": {
        "enabled": true,
        "config": {
          "streaming": {
            "enabled": true,
            "provider": "xai",
            "providers": {
              "xai": {}
            }
          }
        }
      },
      "xai": {
        "enabled": true
      }
    }
  }
}
```

That example enables `Review` with xAI as the OpenClaw Talk transcription
provider. Use it only when `talk.catalog` lists xAI as a configured
Gateway-relay transcription provider.

```json
{
  "tools": {
    "media": {
      "audio": {
        "enabled": true,
        "language": "ja",
        "models": [
          {
            "type": "cli",
            "command": "whisper",
            "args": [
              "{{MediaPath}}",
              "--model",
              "base",
              "--language",
              "ja",
              "--task",
              "transcribe",
              "--output_format",
              "txt",
              "--output_dir",
              "/tmp",
              "--verbose",
              "False",
              "--condition_on_previous_text",
              "False",
              "--no_speech_threshold",
              "0.75"
            ],
            "timeoutSeconds": 90
          }
        ],
        "prompt": "Transcribe short Japanese and English Even G2 voice turns near-verbatim. Preserve OpenClaw session names, commands, product names, and code terms. Return only the transcript."
      }
    }
  }
}
```

That example enables `Send now` through OpenClaw media audio understanding with
a local Whisper CLI fallback. It is usually slower than live `Review`, but it
keeps audio transcription local when the user's OpenClaw host has Whisper
available.

Restart Gateway after changing config, then verify the actual route:

```bash
openclaw gateway restart
openclaw gateway call talk.catalog --json
```

A provider listed in `talk.catalog` is not full proof that live transcription
will succeed. After setup, make one short `Review` recording from the glasses
and confirm transcript text appears before relying on it.

## Troubleshooting

| State | What to do |
| --- | --- |
| `Setup required` | Ask OpenClaw for the Even G2 setup QR, or run `openclaw qr`, then scan it from the phone. |
| `Device approval required` | Run `openclaw devices list`, approve the Even G2 request, then wait or retry. |
| `Operator approval required` | Approve the remaining Even G2 device/operator request. This allows session reads and voice submission. |
| `Node approval required` | Run `openclaw nodes pending`, approve the Even G2 node request, then tap `Check again`. |
| `Origin blocked` | Add the App origin shown on the phone to `gateway.controlUi.allowedOrigins`, restart or reload Gateway if needed, then tap `Retry now`. |
| `Gateway unreachable` | Confirm the Gateway URL is reachable from the phone network. Use secure `wss://` for remote access. |
| `too many failed authentication attempts` | Check pending device and node requests, approve them, then tap `Retry now` after the countdown or use `Set up again` for a fresh QR. |
| `Review needs Gateway setup` | Send the Review setup request to OpenClaw, configure Talk transcription, then tap `Check again`. |
| Voice records but no transcript appears | Fix the Gateway transcription provider or auth. The Even Hub app records audio; OpenClaw owns transcription. |
| Canvas does not appear | Approve node tools and make sure the Even Hub app is open with a live G2 bridge. |

Use `Connection` -> `Set up again` when local pairing is stale or unclear. In
development, close the app or simulator first so it does not immediately
reconnect, then run:

```bash
pnpm dev:reset-pairing -- --dry-run
pnpm dev:reset-pairing
```

## What The App Stores And Sends

- The app sends data only to the configured OpenClaw Gateway endpoint.
- Camera frames are used locally to decode the setup QR.
- Voice input starts only during an active glasses voice action.
- Gateway URL-scoped device tokens, selected session, voice mode, and local app
  settings are stored locally so the next launch can reconnect.
- Treat setup QR codes, setup codes, Gateway URL-scoped device tokens, and
  private Gateway origins as secrets. Do not include them in screenshots, issue
  reports, logs, docs, or packaged builds.
- Provider credentials, model choices, API keys, OAuth profiles, and billing
  decisions stay in OpenClaw Gateway.

See [Privacy Policy](PRIVACY.md) for the full data-handling note.

## Build From Source

Most users should install the Even Hub package rather than build from source.
If you are testing a private build:

```bash
git clone https://github.com/solavrc/openclaw-even-g2-node.git ~/.openclaw/extensions/openclaw-even-g2-node
cd ~/.openclaw/extensions/openclaw-even-g2-node
pnpm install --frozen-lockfile
pnpm run pack
```

This creates `openclaw-even-g2-node.ehpk`.

Useful local checks:

```bash
pnpm check
pnpm run ci
pnpm sim:dev
pnpm sim:capture
```

Simulator checks are useful for HUD layout and setup flow smoke tests. Real
permission prompts, microphone behavior, background behavior, network behavior,
and packaged-runtime behavior still need a private or beta Even Hub build with
real G2 hardware.

## More Documentation

- [User Guide](docs/user-guide.md): full setup, glasses workflow, voice modes,
  reset, and recovery.
- [Gateway Voice Setup](docs/gateway-voice-setup.md): runbook for the
  OpenClaw Agent or operator configuring `Review` and `Send now`.
- [User Stories](docs/user-stories.md): product intent and acceptance checklist.
- [Architecture](docs/architecture.md): responsibility boundaries and node
  surface.
- [OpenClaw Protocol Notes](docs/openclaw-protocol.md): Gateway identity,
  pairing, Talk, chat attachments, canvas, and live bridge constraints.
- [Platform Notes](docs/platform-notes.md): Even Hub SDK, display, background,
  audio, simulator, networking, and QR constraints.
- [Testing](docs/testing.md): CI, simulator, phone UI state review, and real
  device validation.
- [Maintainer Release](docs/maintainers/release.md): Even Hub submission and
  maintainer-only release workflow.
