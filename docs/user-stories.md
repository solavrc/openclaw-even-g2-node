# User Stories

Last reviewed: 2026-06-27.

This document describes the product experiences that implementation and review
should preserve. When changing copy or UI, check the full story rather than the
individual feature in isolation.

## Story 1: First Setup

The user installs `OpenClaw Node` from Even Hub and opens it on the phone. The
glasses first show the product name and the host-side action:

```text
OpenClaw Node
Set up OpenClaw Gateway.
On OpenClaw host:
$ openclaw qr
On phone:
Tap Scan setup QR
```

The phone shows setup state and a `Scan setup QR` action. It does not show a
chat box or prompt presets.

The user runs `openclaw qr` on the OpenClaw host and scans the QR with the
phone. When pairing approval is required, the glasses explain what must be
approved, why it is needed, and where the command should be run. The request ID
shown in the app is only a cross-check; the source to copy from is the OpenClaw
host command output.

Success condition: without using a phone chat surface, the glasses reach the
selected-session screen.

## Story 2: Continue The Current OpenClaw Session

When the user opens `OpenClaw Node` on the glasses, the first view is the last
selected session. On a fresh install, the app uses the default session returned
by Gateway session defaults.

The latest user or agent turn is shown, and the header identifies both the
speaker and the available voice action:

```text
Agent | Tap to speak
```

If a turn is long, the user can press `up` to move to the previous screen of
the same turn and then to earlier turns. `down` moves toward newer content. If
the user is reading older history, new content does not pull the view away from
their position.

Success condition: the user can resume context on the glasses without taking
out the phone.

## Story 3: Switch Sessions From The Phone

From the phone `Session` card, the user chooses an OpenClaw session key from a
selector. The glasses immediately switch to that session and stay in the normal
selected-session view.

Phone controls:

- selector: choose the active OpenClaw session

Opening the selector refreshes sessions from Gateway. Session creation stays in
OpenClaw instead of becoming a phone-only workflow.

The phone shows OpenClaw session keys directly. This avoids ambiguous generated
titles on the glasses when Gateway metadata does not provide a meaningful
conversation title or preview.

Success condition: users can switch sessions without losing the glasses-first
reading and voice interaction loop.

## Story 4: Review Voice Before Sending

While reading a selected session, the user taps once to enter listening state.
While the user speaks, the app streams microphone PCM to OpenClaw Talk
transcription.

When the user taps again to stop recording, the glasses show the transcript:

```text
main · ready               tap send · 2-tap discard

<transcribed text>
```

If the transcript is correct, tap sends it to the selected session. If it is
wrong, double tap discards it. The selected-session context stays visible in
the header so the user knows which conversation will receive the text.

Success condition: voice input is fast enough for conversation, and poor
transcription does not automatically pollute the selected session.

## Story 5: Choose Safety Or Latency

The normal mode is `Review`, but some users or environments may prioritize
lower latency.

The phone voice settings stay compact and expose:

- voice input enabled/disabled;
- `Review`: default safety-first path through OpenClaw Talk transcription;
- `Send now`: fastest path, attaching the captured WAV directly to the
  selected session;
- a recording safety limit so microphone capture cannot run indefinitely;
- an optional Review provider preference chosen from Gateway `talk.catalog`;
- a short setup request the user can send to their normal OpenClaw chat.

The phone does not own provider API keys, model pickers, or OAuth profiles. The
Review provider preference is only a request to use a provider that OpenClaw
already reports as available.

Success condition: provider ownership remains in OpenClaw while the user can
choose between safety and latency.

## Story 6: Show OpenClaw Canvas

When an OpenClaw workflow invokes `canvas.present` on the `Even G2` node, the
glasses show text or an inline image on the compact HUD surface.

If no live glasses client is present, OpenClaw receives
`EVEN_G2_BRIDGE_UNAVAILABLE` rather than silent success. Phone backgrounding
alone does not imply failure if the glasses app keeps accepting input.

Success condition: OpenClaw can treat Even G2 as a real node capability with
clear failure semantics.

## Story 7: Handle Approvals On The Glasses

When OpenClaw requests approval, the glasses show the request summary and
choices. The user can decide inside the glasses-first flow instead of switching
to a phone chat surface.

Success condition: approvals are integrated into the glasses-first OpenClaw
loop.

## Story 8: Recover From Pairing And Gateway Errors

If the app reaches Gateway but authentication repeatedly fails, the app keeps
the original Gateway error visible and adds guidance for known patterns.

For `too many failed authentication attempts`, the app explains that Gateway
was reached but retries are temporarily paused. It tells the user to check
pending approvals, shows retry timing when known, exposes one `Retry now`
control, and offers `Set up again` to clear local pairing before scanning a
fresh QR.

Success condition: the user does not have to guess whether the problem is
network reachability, Gateway reachability, device approval, node approval, or
stale pairing state.

## Non-Goals

This app is not:

- a general OpenClaw phone chat client;
- a provider API-key manager;
- an OpenClaw Gateway settings editor;
- a replacement for Android or iOS companion nodes;
- a workflow that requires phone interaction during normal use.

## Acceptance Checklist

For each release candidate, verify:

- first run shows setup instructions on the glasses;
- the first post-setup view is the selected-session view;
- the phone Session card can switch to another session;
- selected-session double tap uses the standard Even Hub exit confirmation;
- Review mode shows a transcript before sending;
- Send now mode works and Gateway setup is documented;
- canvas commands require a live G2 bridge/client and fail clearly when
  unavailable;
- phone UI remains limited to setup, status, diagnostics, and recovery;
- simulator screenshots are nonblank and readable;
- private/beta builds validate permissions, microphone behavior, foreground
  lifecycle, and packaged network behavior.
