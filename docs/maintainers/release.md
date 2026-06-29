# Maintainer Release

Last reviewed: 2026-06-29.

This document is a maintainer runbook and Even Hub submission draft. It is not
the primary user guide.

## Current Artifact

The packaged Even Hub build is:

```text
openclaw-even-g2-node.ehpk
```

Build it with:

```bash
pnpm run pack
```

The package manifest is `app.json` with package id
`com.solavrc.openclaweveng2node` and store listing name `OpenClaw Node`.

The OpenClaw node display name remains `Even G2`, but the Even Hub app listing
does not contain `Even` because current QA rules reject third-party names that
look first-party.

## Naming Scope

Use `openclaw-even-g2-node` for the repository, package namespace, and
OpenClaw integration boundary. Even has shipped earlier devices, but the current
Even Hub app surface is scoped to G2 apps, so claiming broader device
compatibility would overstate support.

Use `OpenClaw Node` for the Even Hub listing. It matches the Android node
naming pattern and avoids presenting the app as an Even first-party product.
The in-app OpenClaw node name remains `Even G2`, because that is the device the
node represents once paired with OpenClaw.

## Store Listing

Title:

```text
OpenClaw Node
```

Short description:

```text
Use G2 glasses as a compact OpenClaw session, voice, and canvas node.
```

App tagline:

```text
OpenClaw sessions on your glasses
```

App icon:

```text
openclaw-node-evenhub-icon-24.png
```

Long description:

```text
OpenClaw Node connects G2 glasses to your private OpenClaw Gateway.

The glasses become a compact OpenClaw surface: pick a session, read recent
context, dictate a message, review transcript text before sending, approve
requests, and receive OpenClaw text or image canvas updates.

Voice input is routed through OpenClaw. Speech provider, model, subscription,
OAuth, and API key choices stay in your Gateway configuration instead of inside
the glasses app. The phone screen is limited to setup, connection status, HUD
preview, voice mode selection, recovery controls, and diagnostics for support.
```

## Permission Copy

Network:

```text
Opens a WebSocket to the user-configured OpenClaw Gateway setup URL for sessions, voice, and canvas.
```

G2 microphone:

```text
Captures Even G2 microphone audio for OpenClaw voice input.
```

Reviewer note:

```text
OpenClaw Node does not include third-party speech API keys in the package.
Microphone audio is sent only to the configured private OpenClaw Gateway. The
Gateway performs transcription through the user's OpenClaw configuration.
```

## Privacy Policy Draft

Public privacy policy URL:

```text
https://github.com/solavrc/openclaw-even-g2-node/blob/main/PRIVACY.md
```

```text
OpenClaw Node is a companion node for a user-controlled OpenClaw Gateway.

Data processed:
- Gateway connection settings entered by the user or provided through local
  test links.
- Selected OpenClaw session identifiers.
- Text sent to and received from OpenClaw.
- Even G2 microphone audio while voice input is active.
- Camera frames or decoded QR contents while scanning an OpenClaw setup QR.
- Diagnostic status such as Gateway connection state, node state, and current HUD
  view.

Data handling:
- The Even Hub app sends data only to the configured OpenClaw Gateway endpoints.
- Camera frames are used locally to extract an OpenClaw setup code from a QR
  code. The app does not upload QR camera images to the Gateway or any other
  service.
- Speech provider selection, transcription model, and provider API keys are
  controlled by OpenClaw and are not stored in the Even Hub package.
- The app stores local settings such as normalized Gateway URL, selected
  session, voice/display settings, and Gateway URL-scoped device tokens in
  browser `localStorage` and mirrors them to Even Hub bridge storage when
  available so the next launch can reconnect.
- The app does not sell data or send analytics to a third-party analytics
  service.

User control:
- Voice input starts only when a live Even Hub bridge opens the microphone.
- Closing the app or disabling voice stops microphone capture.
- Users can revoke app permissions through Even Hub or uninstall the app.

Contact:
- Use GitHub Issues for privacy, support, and deletion requests:
  https://github.com/solavrc/openclaw-even-g2-node/issues
```

## Screenshots To Capture

Current Even Hub screenshots are kept in `release/evenhub-screenshots/`.
Use up to the store limit, but keep the default set focused on:

- `01-glass-setup.png`: setup onboarding, with the short `Ask OpenClaw with`
  prompt and OpenClaw logo background.
- `02-glass-chat.png`: selected-session chat preview using the real session HUD
  renderer.
- `03-glass-voice-review.png`: Review voice input preview using the real voice
  panel renderer.
- `04-glass-canvas.png`: canvas tutorial visual preview.
- `05-phone-setup.png`: phone setup/status screen.
- `06-phone-voice-input.png`: phone Voice input settings screen.

Use [user-guide.md](../user-guide.md) as the source of truth for expected user
flows when selecting screenshot states.

Use the official simulator camera button for store screenshots when possible.
The generated PNG must represent a screen the app can actually show. Useful
HUD states:

```bash
pnpm dev -- --host 127.0.0.1 --port 5174 --strictPort

pnpm simulator 'http://127.0.0.1:5174/?resetPairing=1' --automation-port 9898
pnpm simulator 'http://127.0.0.1:5174/?resetPairing=1&simFixture=storeChat' --automation-port 9898
pnpm simulator 'http://127.0.0.1:5174/?resetPairing=1&simFixture=storeVoice' --automation-port 9898
pnpm simulator 'http://127.0.0.1:5174/?resetPairing=1&simFixture=canvasTutorial' --automation-port 9898
```

For local visual checks, `pnpm sim:fixtures` and `pnpm sim:capture` also
write review PNGs. Use those for quick inspection, but prefer the official
simulator camera button when preparing final Even Hub listing images. The raw
`glassesPath` PNG can appear solid green in normal image viewers because the
simulator encodes the useful HUD signal in alpha.

Use real G2 private or beta testing for final approval screenshots and
lifecycle evidence.

After replacing files in `release/evenhub-screenshots/`, stamp them with the
current UI/source fingerprint:

```bash
pnpm release:screenshots:mark
```

`pnpm release:bundle` and `pnpm release:status` reject store screenshots
whose source manifest is missing or older than the current simulator/UI source.
This does not replace visual review; it prevents accidentally bundling
screenshots from a previous UI revision.

## Release Versioning

Patch version bumps are reserved for local Even Hub package checks, where
installing frequent `.ehpk` builds is part of hardware validation. Release
Please uses a minor-version cadence so published GitHub releases represent
reviewable integration checkpoints instead of local package iterations.

Use an explicit Release Please `Release-As` footer when a future release needs a
major version instead of the default minor bump.

## Release Notes

Version `0.1.17`: <!-- x-release-please-version -->

```text
Initial OpenClaw Node beta.

- Adds Even G2 as an OpenClaw node with device, talk, and canvas capabilities.
- Adds selected-session log on the glasses and session selection on the phone.
- Adds voice input through OpenClaw-owned transcription.
- Adds approval prompts and text/image canvas display.
- Keeps phone UI focused on setup, status, diagnostics, and latest glasses
  content.
```

## Current Public Review Risk

`app.json` currently leaves `permissions[].network.whitelist` empty.
The preferred public architecture is a direct connection from the Even Hub app
to a user-owned OpenClaw Gateway, normally exposed through OpenClaw's
recommended secure remote-access path such as Tailscale/VPN, Tailscale
Serve/Funnel, or another user-managed `wss://` endpoint.

The project decision is to proceed with Even Hub review using this direct
user-owned Gateway design, then handle any whitelist rejection in review rather
than introducing a developer-operated proxy up front. Official networking docs
say WebSockets are subject to the whitelist, entries are full origins, and
wildcard domains are not documented as supported. Local observations suggest
user-owned WebSocket endpoints can work in some current builds, but that is not
a public-review guarantee.

Do not place wildcard examples such as `wss://*.ts.net` in
`app.json`. The manifest is enforcement input, not reviewer commentary,
and official docs say wildcard domains are unsupported. Keep the whitelist empty
for the review submission, then use the review note below to ask which
declaration Even Hub wants for runtime user-owned Gateway URLs.

If review rejects the package on network permission grounds, ask Even Hub review
to confirm one of these compliant declarations:

- runtime-configured user-owned WebSocket Gateway URL/setup codes are an approved pattern;
- a Tailscale wildcard such as `wss://*.ts.net` is acceptable;
- WebSocket origins should be represented as HTTPS origins, for example
  `https://*.ts.net`;
- wildcard user-owned endpoints are not allowed, in which case review guidance
  is needed before changing the architecture.

Do not add developer/private origins or a developer-operated generic tunnel as
the default public strategy unless Even Hub review explicitly requires that
architecture. The empty whitelist is intentional for the current review
submission posture, because the Gateway endpoint is user-owned and configured
at runtime.

The selected-session surface is the logical root page. It must call
`shutDownPageContainer(1)` on root-page double-tap so Even Hub shows the system
exit-confirmation dialog. Do not replace this with a custom in-app exit dialog
or a no-op.

## Review Inquiry Draft

```text
Hello Even Hub review team,

We are preparing OpenClaw Node for Even G2. The app connects the glasses to a
user-owned OpenClaw Gateway. The Gateway is controlled by the user, and
OpenClaw recommends secure remote Gateway-node connectivity through
Tailscale/VPN, Tailscale Serve/Funnel, or another user-managed secure WebSocket
endpoint.

The Gateway endpoint is configured by the user at runtime, so the exact origin is
not known when the .ehpk is packaged. We would like to avoid routing user
traffic through a developer-operated generic proxy, because that would make us a
traffic-inspecting trust boundary unless we add another application encryption
layer.

What is the approved Even Hub network-permission declaration for this pattern?

Specifically:
- Are runtime-configured user-owned WebSocket Gateway URL/setup codes an approved pattern?
- Can user-owned Tailscale Gateway endpoints be declared with wss://*.ts.net?
- If WebSocket origins are represented as HTTPS origins in app.json, should the
  declaration be https://*.ts.net instead?
- If wildcard user-owned endpoints are not supported, what architecture do you
  recommend for an app that connects to a user's private OpenClaw Gateway?
- If a fixed backend is required, what privacy disclosure would you expect?

The app does not embed OpenClaw tokens or speech-provider API keys in the
package. Speech transcription provider choice remains inside the user's
OpenClaw Gateway.
```

## Release Gates

### Default CI Gate

Run this before handing off normal code changes:

```bash
pnpm ci
```

This is the GitHub Actions-equivalent gate. It intentionally avoids ADB, Pixel,
Tailscale, portal login, and real OpenClaw configuration.

### Private/Internal Rehearsal And Review-Submission Gate

The current app manifest intentionally contains no fixed network origins. The
decided review path is to submit this as a network review risk instead of
blocking on a developer-operated proxy design. Rehearse private/internal and
review-submission builds with:

```bash
pnpm release:check
pnpm release:bundle:summary
pnpm release:status:summary
```

`release:status:summary` should report:

- `privateRehearsalReady: true`
- `reviewSubmissionReady: true`
- `publicReleaseReady: false`
- no hard public blockers after GitHub `origin` is configured
- `reviewRisks` item for the runtime user-owned WebSocket Gateway whitelist
- `privateRehearsalBlockers: []`

Use `pnpm release:status` when you need the full bundle manifest and
screenshot metadata in one JSON document. Use the summary command for ordinary
checks so the terminal output stays reviewable.

This means the package is suitable for maintainer rehearsal and Even Hub review
submission, while final public release still depends on review accepting or
directing the network declaration.

### Public Upload Gate

Before submitting for Even Hub review:

- run `pnpm audit:all` locally, or run `pnpm release:check` and
  `pnpm release:bundle:summary`;
- optionally run `pnpm sim:fixtures` or the manual `Simulator Fixtures`
  GitHub Actions workflow when the change touches glasses layout, Even Hub
  events, lifecycle, or phone/glasses rendering parity;
- run `pnpm release:status:summary` and confirm
  `reviewSubmissionReady: true`; use `pnpm release:status` if you need to
  inspect the full bundle manifest and screenshot metadata;
- confirm the GitHub repository exists at
  `https://github.com/solavrc/openclaw-even-g2-node`;
- confirm `origin` is `https://github.com/solavrc/openclaw-even-g2-node.git`;
- confirm the pushed branch is the intended release-candidate history;
- push only after explicit maintainer approval;
- confirm the privacy and support URLs are public;
- perform a private build install from the portal;
- perform a beta build install from the portal;
- run the background/locked-phone lifecycle test: ordinary Gateway connection
  should survive or recover from saved setup state; if the glasses app remains
  interactive while the phone is backgrounded, voice/canvas/PTT should still
  work through the live bridge; if the WebView is unloaded or the bridge is
  lost, active voice capture must stop rather than leave hidden transcription
  requests running;
- confirm selected-session double-click shows the Even Hub system exit
  confirmation;
- run permission denial-path tests for network and G2 microphone.

After Even Hub review confirms the acceptable network declaration, update
`app.json` if required, run `pnpm release:check`, and confirm
`publicReleaseReady: true` before treating the package as final public-release
ready.

`pnpm ci` delegates to `pnpm release:check`, which wraps:

- `pnpm check`
- `pnpm audit`
- Even Hub app packaging smoke
- release artifact audit
- visual asset audit
- submission asset consistency checks
- `pnpm exec evenhub pack -c app.json dist -o /tmp/openclaw-node-check.ehpk`

The final Even Hub CLI availability probe is best-effort by default so CI can
run without portal login. Set `EVENG2_REQUIRE_EVENHUB_LOGIN=1` in a maintainer
shell when login freshness and package availability should be mandatory.

`pnpm audit:all` runs `ci`, `release:bundle:summary`, and
`release:status:summary` in sequence. It intentionally does not start the Even
Hub simulator; use `pnpm sim:fixtures` separately when visual smoke is useful.

Set `EVENG2_ALLOW_DEV_NETWORK_WHITELIST=1` only when rehearsing a private or
internal build with local, LAN, or tailnet origins.

## Versioning

Versioning is managed by Release Please on `main`.

Release Please opens a release PR from Conventional Commits and keeps these
files in sync:

- `package.json`
- `app.json`
- `.release-please-manifest.json`

For Even Hub Developer Hub cache-busting or a same-code resubmission before a
Release Please PR exists, manually advance the patch version:

```bash
pnpm version:bump -- patch
```

The command updates `package.json`, `app.json`,
`.release-please-manifest.json`, and the store release-notes version together.
Use an exact three-part version instead of `patch` only when a specific Even Hub
upload version is required:

```bash
pnpm version:bump -- 0.1.3
```

Run `pnpm release:check` before packing. Release Please remains the normal
release automation on `main`; the manual patch bump is only for explicit
maintainer cache-busting or review-upload needs.

Use Conventional Commit prefixes for user-facing changes:

```text
feat: add canvas queue status
fix: recover from stale Gateway tokens
docs: update Even Hub setup guidance
chore: refresh simulator fixtures
```

The Release Please PR creates the Git tag and GitHub Release after merge. It
also builds a versioned `.ehpk` from the release commit and attaches it to the
GitHub Release. It does not upload to Even Hub. Keep portal upload and review
submission as manual maintainer steps because they depend on portal state,
review timing, and the current network-whitelist posture.

While the app is pre-1.0, Release Please is configured so `fix:` and `feat:`
commits produce patch releases, while breaking changes produce minor releases.
This keeps normal release artifacts aligned with Even Hub cache-busting needs
without using prerelease or build metadata that Even Hub packaging does not
accept.

Every `.ehpk` uploaded for real-device validation should have a new
`app.json`/package patch version so Even Hub does not reuse a cached package.
The phone `Advanced diagnostics` panel shows `Version`; use that row to confirm
the installed portal build before interpreting real-device results. Even Hub
packaging requires `app.json.version` to be plain `x.y.z`, so use patch
increments for real-device snapshots.

`pnpm release:bundle` creates a Git-ignored portal handoff directory under
`release/<package-id>-<version>/` containing:

- versioned `.ehpk`;
- copied `app.json`;
- copied `PRIVACY.md`;
- `bundle-manifest.json` with size, SHA-256, and network review metadata;
- `submission-copy.md` with listing, permission, privacy, release note, blocker,
  and review inquiry text.

Create the bundle only after `release:check` passes for the intended release
mode. For the current private/internal rehearsal state:

```bash
pnpm release:check
pnpm release:bundle:summary
pnpm release:status:summary
```

Use `pnpm release:bundle` instead when you need the full bundle manifest JSON
in terminal output. Both commands create the same release directory.

`pnpm release:status:summary` is a lightweight preflight summary. It does not
run the full test suite. It reports the current package id, version, readiness
flags, known review risks, Git HEAD, release bundle checksum, screenshot count,
and artifact warnings. `pnpm release:status` prints the full JSON
report with bundle details, optional simulator fixture metadata, screenshot metadata,
Git remote, branch commit count, privacy URL, and support URL. If
`openclaw-even-g2-node.ehpk` exists and differs from the release bundle `.ehpk`,
rerun `pnpm release:bundle:summary`.

## GitHub Publication Gate

Before submitting a public Even Hub build, confirm the GitHub repository and
local remote:

```bash
gh repo view solavrc/openclaw-even-g2-node --json nameWithOwner,url,visibility
git remote get-url origin
```

Do not push until the maintainer has explicitly approved publication of the
release-candidate branch. After push, confirm these public URLs:

- https://github.com/solavrc/openclaw-even-g2-node
- https://github.com/solavrc/openclaw-even-g2-node/blob/main/PRIVACY.md
- https://github.com/solavrc/openclaw-even-g2-node/issues

## Human Review Before Upload

- Confirm the GitHub Issues support URL is public.
- Confirm the public privacy policy URL is reachable.
- Confirm package id `com.solavrc.openclaweveng2node` availability after login.
- Resolve Even Hub review guidance for user-owned OpenClaw Gateway endpoints.
- Confirm no OpenClaw token, provider API key, or personal tailnet secret is
  bundled into the `.ehpk`.
- Confirm screenshots are from the current build.
