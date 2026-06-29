# Privacy Policy

Last reviewed: 2026-06-29.

OpenClaw Node is a companion node for a user-controlled OpenClaw Gateway.

## Data Processed

OpenClaw Node may process:

- Gateway connection settings entered by the user or provided through local test
  links;
- selected OpenClaw session identifiers;
- text sent to and received from OpenClaw;
- Even G2 microphone audio while voice input is active;
- camera frames or decoded QR contents while scanning an OpenClaw setup QR;
- diagnostic status such as Gateway connection state, node state, and current HUD
  view.

## Data Handling

- The Even Hub app sends data only to the configured OpenClaw Gateway endpoint.
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

## User Control

- Voice input starts only when the live Even Hub bridge opens the G2 microphone
  for an active voice action.
- Closing the app or disabling voice stops microphone capture.
- Users can revoke app permissions through Even Hub or uninstall the app.

## Contact

Use GitHub Issues for privacy, support, and deletion requests:

https://github.com/solavrc/openclaw-even-g2-node/issues
