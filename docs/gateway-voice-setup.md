# Gateway Voice Setup For OpenClaw Agents

Last reviewed: 2026-06-27.

This page is written for the OpenClaw Agent or maintainer that a user asks to
configure voice input for OpenClaw Node on Even G2. Treat it as a runbook for
reading the user's existing Gateway config, choosing the least surprising voice
route, editing only the required fields, and troubleshooting known failures.

Read these official OpenClaw docs before editing unfamiliar fields:

- [Talk mode](https://docs.openclaw.ai/nodes/talk) for `Review`
  transcription-only Talk sessions.
- [Gateway protocol](https://docs.openclaw.ai/gateway/protocol) for
  `talk.session.create`, `talk.session.appendAudio`, and
  `talk.session.close`.
- [Audio and voice notes](https://docs.openclaw.ai/nodes/audio) and
  [Media understanding](https://docs.openclaw.ai/nodes/media-understanding) for
  `Send now` audio attachments and `tools.media.audio`.
- [xAI provider](https://docs.openclaw.ai/providers/xai) and
  [OpenAI provider](https://docs.openclaw.ai/providers/openai) before changing
  provider-specific auth or model assumptions.
- [Configuration reference](https://docs.openclaw.ai/gateway/configuration-reference)
  for schema lookups. Prefer the Gateway config schema lookup tool when
  available before writing exact fields.

The app shows a mode-specific short request so it remains possible to type by
hand:

```text
Set up OpenClaw Even G2 Review voice. See solavrc/openclaw-even-g2-node.
Set up OpenClaw Even G2 Send now voice. See solavrc/openclaw-even-g2-node.
```

When you receive one of those requests, configure the matching OpenClaw Gateway
surface. `Review` and `Send now` have different requirements. Do not ask the
user to enter provider keys, OAuth tokens, or model names in the Even Hub app.
Provider, model, OAuth profile, API key, prompt, and billing choices belong to
OpenClaw Gateway.

The phone may store a preferred `Review` provider ID, but only from providers
already returned by `talk.catalog`. If that preferred provider is missing or no
longer configured, the app should ask for Gateway setup instead of silently
falling back to another provider.

## Decision Checklist

Before changing config, inspect the existing setup:

1. Read `~/.openclaw/openclaw.json`.
2. Check whether `plugins.entries["voice-call"]` exists and whether
   `plugins.entries["voice-call"].config.streaming` is already configured.
3. Confirm `plugins.entries["voice-call"].config.realtime.enabled` is not also
   enabled. OpenClaw rejects `voice-call.config.realtime.enabled` and
   `voice-call.config.streaming.enabled` being true at the same time.
4. Check which provider plugins are enabled, especially `xai` and `openai`.
5. Check whether the user already relies on a subscription-backed route such as
   xAI auth profile. Do not replace it with a metered API-key route without
   permission.
6. Check `tools.media.audio` before changing `Send now` behavior.
7. Restart Gateway only after writing config changes, then validate with
   `talk.catalog`.

Provider choice:

1. Prefer `xai` for `Review` when the user's OpenClaw xAI auth profile is
   subscription-backed and `talk.catalog` confirms that xAI is usable for
   gateway-relay transcription.
2. Treat the other realtime transcription providers as parallel alternatives,
   not as this app's default recommendation. OpenAI realtime transcription is
   an OpenAI Realtime/API path, not something to assume is covered by a
   ChatGPT subscription.
3. Prefer local Whisper or another local audio model for `Send now` when the
   user wants to avoid metered provider billing and accepts higher latency.
4. Do not choose a provider only because it appears in a model list. For
   `Review`, the provider must appear as a usable Talk transcription provider.

## Required OpenClaw Surfaces

OpenClaw Node uses two different Gateway paths:

- `Review` uses OpenClaw Talk realtime transcription. This requires the
  `voice-call` plugin because OpenClaw currently reads Talk streaming STT
  configuration from `plugins.entries["voice-call"].config.streaming`.
  It also requires the selected provider plugin, such as `xai` or `openai`, to
  be enabled and configured enough to appear in `talk.catalog`.
- `Send now` sends a completed audio attachment to the selected session with
  `chat.send`. OpenClaw then decides how the selected Agent interprets the
  audio, usually through `tools.media.audio`.

Do not configure these paths inside the Even Hub app. The app only records G2
audio, chooses `Review` or `Send now`, and sends the audio/text to Gateway.

Important config boundary: Even G2 `Review` uses
`plugins.entries["voice-call"].config.streaming`, not
`plugins.entries["voice-call"].config.realtime`. The `voice-call` plugin's
runtime validation rejects configurations where both
`voice-call.config.streaming.enabled` and `voice-call.config.realtime.enabled`
are true. If the user also wants a separate realtime conversation surface,
prefer the Talk realtime configuration path instead of enabling
`voice-call.realtime` alongside Even G2 Review.

## User-Facing Summary

Tell the user:

- `Review` is the recommended mode. It transcribes while the user is speaking
  and lets them approve the text on the glasses before sending.
- `Send now` is the fastest mode. It sends the captured audio directly to the
  selected OpenClaw session.
- Subscription-backed routes are preferred when available. When the user's xAI
  auth profile is X Premium-backed, an xAI Talk request without `XAI_API_KEY`
  can be treated as the preferred subscription path.
- Local Whisper can avoid provider billing, but it is usually too slow for
  live `Review`. It fits the attachment-based `Send now` path better.

## Review Mode

`Review` streams Even G2 microphone PCM to OpenClaw Talk while the user is
speaking. The app expects OpenClaw Talk transcription to support:

- `mode: "transcription"`
- `transport: "gateway-relay"`
- `brain: "none"`

For this app, configure the provider through
`plugins.entries["voice-call"].config.streaming`. Do not enable
`plugins.entries["voice-call"].config.realtime` as part of Even G2 Review
setup; that field is for the voice-call plugin's realtime voice runtime and is
mutually exclusive with the streaming transcription path used here.

Check the current Gateway state:

```bash
openclaw gateway call talk.catalog --json
```

The catalog is ready for Review when `transcription.providers` contains a
configured provider with:

- `configured: true`
- `modes` including `transcription`
- `transports` including `gateway-relay`
- `brains` including `none`

If `transcription.activeProvider` points at a provider that is missing from
`transcription.providers`, or does not satisfy those fields, fix the Gateway
configuration before telling the user Review is ready. OpenClaw Node follows the
provider list, not `activeProvider` alone.

`talk.catalog` is an availability check, not a full provider-auth probe. A
provider can appear ready in the catalog and still fail on the first real
`talk.session.create` because its auth profile expired, endpoint support
changed, or provider credentials are rejected. When that happens, keep the
provider's exact error text visible to the user and repair Gateway provider
auth/config rather than changing the Even Hub app.

Some current OpenClaw builds can report `activeProvider: "xai"` while only
listing another provider, such as `openai`, in `transcription.providers`. In
that state, xAI is not usable for Review even though it is selected in
`voice-call.streaming.provider`; `talk.session.create` with `provider: "xai"`
will fail with `Realtime transcription provider "xai" is not configured`.
Treat this as Gateway setup needing attention. `activeProvider` is only the
configured provider id; the usable Review providers are the registered and
configured entries in `talk.catalog.transcription.providers`.

Observed root cause in OpenClaw testing: capability-provider discovery can keep
an active realtime transcription registry that contains `openai`, then skip
cold-loading the configured `voice-call.streaming.provider` because that config
path is not collected as a requested realtime transcription provider. The
upstream fix is tracked in
[openclaw/openclaw#97170](https://github.com/openclaw/openclaw/pull/97170).
Until that fix is available in the user's installed OpenClaw version, refreshing
the plugin registry and restarting the Gateway is the safest recovery.

Bundled realtime transcription provider candidates include:

- `xai`
- `openai`
- `deepgram`
- `elevenlabs`
- `mistral`

Only providers that appear in `talk.catalog.transcription.providers` as
configured `gateway-relay` transcription providers are usable for `Review`.
This app's default recommendation is `xai` when OpenClaw can resolve a
subscription-backed xAI auth profile. Other providers can work if the user has
already configured or intentionally chooses them. Do not present OpenAI as the
default fallback just because it is commonly available.

### Live Partial Expectations

`Review` is most useful when Gateway emits partial transcript events while the
user is still speaking. The Even Hub app cannot force that behavior. It streams
PCM chunks to OpenClaw Talk and renders whatever Talk emits:

- `transcript.partial` / delta events become live text on the glasses;
- `transcript.final` becomes the review text after the user stops;
- if no partials arrive, the recording screen can remain blank until stop even
  though audio is being sent correctly.

Do not treat provider or model names as a reliable delta-strategy signal. The
node does not know whether Gateway is using server VAD, manual commit,
provider endpointing, provider-specific delay settings, or another strategy.
Use real `talk.event` behavior as the source of truth.

Observed local behavior:

- `voice-call.streaming.provider = "openai"` with the current OpenClaw OpenAI
  realtime transcription provider successfully returned a final transcript
  after stop/close, but did not emit visible partial text during a roughly
  12-second recording.
- `voice-call.streaming.provider = "xai"` is expected to be the better Review
  path when xAI appears in `talk.catalog.transcription.providers`, because the
  xAI realtime transcription provider exposes interim results. If
  `transcription.activeProvider` is `xai` but the provider list lacks `xai`,
  fix Gateway/provider discovery instead of silently using another provider.

For OpenAI, `gpt-4o-transcribe` is a transcription model that may behave more
like final-after-commit in this Gateway path. OpenAI's `gpt-realtime-whisper`
is better aligned with live transcription, but the Gateway provider must also
support the matching session payload, audio format, delay/endpointing, and
commit strategy. Do not assume that changing only a model string is sufficient.

### xAI Review Setup

Enable the `voice-call` plugin's streaming transcription path and select xAI:

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

Restart OpenClaw if config changed, then rerun `talk.catalog`. A working setup
should show `transcription.activeProvider: "xai"` and an `xai` entry with
`configured: true`.

If `activeProvider` is `xai` but the `xai` entry is absent, do not tell the user
Review is ready. First refresh the persisted plugin registry, then restart
Gateway:

```bash
openclaw plugins registry --refresh
openclaw gateway restart
openclaw gateway call talk.catalog --json
```

If the provider is still absent, switch Review to a provider that is actually
listed or ask OpenClaw to inspect provider registration.

Anti-patterns to avoid:

- Do not set `voice-call.streaming.provider = "xai"` and stop there. Confirm
  `talk.catalog.transcription.providers[]` actually contains configured xAI.
- Do not assume `XAI_API_KEY` is required. If the user's OpenClaw xAI auth
  profile is X Premium-backed, API-key-free xAI requests can be the intended
  subscription route.
- Do not replace the user's default Agent model with an xAI or OpenAI API-key
  route just to make voice work. Voice configuration should be scoped to Talk.

### OpenAI Review Setup

Use OpenAI only when the user intentionally wants OpenAI realtime
transcription and accepts that it is an OpenAI Platform/API route rather than
ordinary ChatGPT subscription usage:

```json
{
  "plugins": {
    "entries": {
      "voice-call": {
        "enabled": true,
        "config": {
          "streaming": {
            "enabled": true,
            "provider": "openai",
            "providers": {
              "openai": {
                "model": "gpt-4o-transcribe",
                "language": "ja"
              }
            }
          }
        }
      },
      "openai": {
        "enabled": true
      }
    }
  }
}
```

OpenAI realtime transcription uses the OpenAI Realtime/API surface. In
OpenClaw, the provider can use `plugins.entries.voice-call.config.streaming.providers.openai.apiKey`,
`OPENAI_API_KEY`, or an OpenClaw `openai` OAuth profile that mints a Realtime
transcription client secret. Do not treat `talk.catalog` or a successful
`talk.session.create` response as proof that this path works: verify that the
session reaches `talk.event` `ready` and returns transcript text. In local
testing, an OAuth-only OpenAI setup reached `talk.session.create` but failed
before `ready` with the client-secret error below. Do not imply that OpenAI
realtime transcription is covered by the user's ChatGPT subscription. OpenAI's
own billing guidance says ChatGPT subscriptions and API Platform usage are
billed separately.

Known failure pattern:

```text
OpenAI Realtime transcription client secret failed (404): Invalid URL
(POST /v1/realtime/transcription_sessions)
```

This means the Even Hub app reached Gateway and Gateway attempted the configured
OpenAI realtime transcription path, but the provider request failed. Treat it
as a Gateway/provider issue: verify the installed OpenClaw version, OpenAI
provider implementation, auth profile/API key, and current OpenAI realtime
transcription endpoint support. Do not debug this as a glasses microphone or
Even Hub permission problem.

## Send Now Mode

`Send now` sends a completed WAV attachment to the selected session. It does
not use the streaming Talk path. The selected Agent receives the audio
attachment and OpenClaw's normal media-understanding pipeline decides how to
interpret it. Configure OpenClaw media audio understanding:

```text
tools.media.audio.models
tools.media.audio.prompt
```

A local-first setup can use a CLI transcription entry such as Whisper to avoid
metered provider billing. A provider model can be faster or more accurate. A
provider plus local fallback chain is also reasonable.

Example local Whisper fallback:

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

Use a prompt that treats Even G2 input as short dictation and preserves
OpenClaw terms, session names, commands, product names, and code identifiers.

Anti-patterns to avoid:

- Do not configure local Whisper as the expected `Review` path unless the
  user's OpenClaw installation has an actual low-latency streaming Talk bridge
  for it. CLI Whisper is a batch file path and belongs to `Send now`.
- Do not let Whisper's raw phonetic errors become the final user turn without a
  prompt or correction strategy. If using local Whisper for `Send now`, keep a
  media-audio prompt that preserves product names and command terms.
- Do not send completed audio to an internal draft Agent session for normal
  `Review`. It is much slower than Talk streaming and creates unnecessary
  context pollution.

## Troubleshooting Playbook

### `Review` says the provider is not configured

Example:

```text
Realtime transcription provider "xai" is not configured
```

Check:

```bash
openclaw gateway call talk.catalog --json
```

Fix:

- If `activeProvider` is `xai` but `providers[]` lacks xAI, refresh the plugin
  registry and restart Gateway.
- If xAI is present but `configured: false`, repair xAI auth/profile setup.
- If the user selected a preferred provider in the phone app and that provider
  disappeared, either restore that provider or tell the user to choose
  `Gateway default`.

### `Review` is marked ready but the first recording fails

`talk.catalog` does not prove live auth or endpoint success. Use the exact
provider error. Common causes are expired OAuth/auth profile, missing provider
plugin, stale plugin registry, or provider endpoint mismatch.

Fix Gateway/provider config, restart Gateway if needed, then retry from the
Even Hub app. Do not move provider credentials into the app.

### xAI appears only after Gateway restart

This is the known provider-resolution issue described above. Make sure the
installed OpenClaw includes the fix from
[openclaw/openclaw#97170](https://github.com/openclaw/openclaw/pull/97170), or
use registry refresh plus Gateway restart as a recovery.

### User wants no metered STT

For `Review`, first try subscription-backed xAI if their OpenClaw xAI route is
available and usable in `talk.catalog`.

For `Send now`, prefer local Whisper or another local `tools.media.audio`
model. Explain that this is usually slower and less suitable for live review.

### Do not change unrelated model routes

Most OpenClaw users expect their default Agent model to stay on their existing
subscription-backed route. Voice setup should not silently move
`agents.defaults.model`, session model overrides, or channel defaults to a
metered provider.

## Constraints

- Do not change the user's default agent inference route to a metered API
  provider unless the user explicitly asked for it.
- Do not move provider credentials into the Even Hub app.
- Do not assume xAI is usable for Review unless it appears as a valid Talk
  transcription provider in `talk.catalog`.
- Do not recommend local Whisper for live Review unless the user's hardware and
  OpenClaw Talk path actually support low-latency streaming transcription.
- Do not confuse `tools.media.audio` with Talk. `tools.media.audio` is the
  attachment/file path and cannot provide live Review candidates while the user
  is still speaking.

## After Setup

Tell the user to return to the Even Hub app. The app periodically checks
Gateway capability and shows voice status near the top of the phone screen.

Suggested final response to the user:

```text
I configured OpenClaw Even G2 voice. Return to the Even Hub app and tap Retry
or wait for the status check. Review uses OpenClaw Talk; Send now uses the
normal audio attachment path.
```
