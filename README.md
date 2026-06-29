# Even G2 Node

Even G2 Node connects Even G2 glasses to a user-controlled OpenClaw Gateway.
The glasses become a compact OpenClaw node for session reading, voice input,
approvals, and text or image canvas updates.

Repository and package namespace: `openclaw-even-g2-node`

Even Hub listing name: `OpenClaw Node`

OpenClaw node display name: `Even G2`

## Documentation

- [User Guide](docs/user-guide.md): setup, glasses workflow, voice modes, reset,
  and recovery.
- [User Stories](docs/user-stories.md): product intent and acceptance checklist.
- [Architecture](docs/architecture.md): responsibility boundaries, node surface,
  session routing, voice boundary, and filtering rules.
- [OpenClaw Protocol Notes](docs/openclaw-protocol.md): Gateway identity,
  pairing, Talk, chat attachments, canvas, and live bridge constraints.
- [Gateway Voice Setup](docs/gateway-voice-setup.md): instructions for the
  user's OpenClaw Agent to configure `Review` and `Send now`.
- [Platform Notes](docs/platform-notes.md): Even Hub SDK, display, background,
  audio, simulator, networking, and QR constraints.
- [Testing](docs/testing.md): CI, simulator, phone UI state review, and real
  device validation.
- [Maintainer Release](docs/maintainers/release.md): Even Hub submission and
  maintainer-only release workflow.
- [Privacy Policy](PRIVACY.md): processed data, storage, permissions, and
  contact.

## Quick Start

Prerequisite: Node.js 22.19.0 or newer.

```bash
git clone https://github.com/solavrc/openclaw-even-g2-node.git ~/.openclaw/extensions/openclaw-even-g2-node
cd ~/.openclaw/extensions/openclaw-even-g2-node
pnpm install --frozen-lockfile
pnpm build
pnpm run pack
```

The pack command creates `openclaw-even-g2-node.ehpk`.

## Pair With OpenClaw

On the OpenClaw Gateway host:

```bash
openclaw qr
```

In Even Hub, open `OpenClaw Node` and tap `Scan setup QR`. Approve the pending
Even G2 request on the OpenClaw host when Gateway asks for it.

For local development approval loops:

```bash
pnpm device:preview:latest
pnpm device:approve:latest
```

To reset local development pairing:

```bash
pnpm dev:reset-pairing -- --dry-run
pnpm dev:reset-pairing
```

Close the Even Hub app or simulator before resetting so it does not reconnect
and recreate state immediately.

## Common Development Commands

```bash
pnpm check
pnpm ci
pnpm dev
pnpm sim:dev
pnpm sim:capture
pnpm sim:fixtures
pnpm audit:all
```

Use `pnpm check` for the normal inner-loop gate. Simulator commands are
optional visual smoke for glasses layout, Even Hub events, lifecycle behavior,
and phone/glasses rendering parity. Real permission, microphone, background,
network, and packaged-runtime behavior need private/beta Even Hub builds and
real G2 hardware.

## Security

Treat OpenClaw Gateway setup codes, device tokens, provider credentials, and
private Gateway origins as secrets. Do not put them in `.ehpk`, URLs,
screenshots, docs, or logs.

Provider, model, API-key, OAuth, and subscription decisions belong to OpenClaw
Gateway. The Even Hub package captures audio and chooses app-level routing; it
does not store provider credentials.
