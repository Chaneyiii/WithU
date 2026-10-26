# D7: local MCP App media and voice coordination

The bundled standard MCP App contains an explicitly labelled local audio fixture. It generates a short WAV in the App, requires a user click to play, and uses no external media service or account. This fixture is for verification inside the existing App surface; it adds no persistent main-stage or navigation entry.

Trusted `RealtimeCall` instances mark the renderer media coordinator busy before microphone acquisition or message reading begins. The coordinator sends only `{version: 1, voiceBusy: boolean}` through the official SDK host context extension `withuMedia`; it sends no transcript, audio, credential or action authorization. Overlapping call/read instances keep media blocked until all instances end. Acquisition failure and teardown release their token.

The App pauses its audio and disables playback while voice is busy. When voice ends, the button becomes available but playback stays paused until the user clicks again. The App starts with playback disabled until a valid host context arrives. Teardown pauses and unloads audio. The iframe remains opaque and has no microphone, Node, preload, network, popup or navigation access. Both parent and App CSP permit only local `data:` media.

## Verified on 2026-10-18

- `npm test --workspace @withu/mcp-app-demo`: 15/15 passed, including actual RealtimeCall acquisition/hangup/failure lifecycle and overlapping sessions over App/AppBridge SDK transports.
- `node checks/realtime-client.mjs`: passed, including pending acquisition, reconnect, audio batching and late-session release.
- `npm run test:browser --workspace @withu/mcp-app-demo`: passed in Electron, including actual audio element playback, SDK-driven pause, disabled playback during voice, and no autoplay after voice completion. Existing SDK handshake, opaque sandbox, nonce CSP and missing-D4 fail-closed assertions also passed.

## Remaining verification

This proves the local self-owned App coordination path. Real conversation-triggered App selection/rendering, third-party players and media services, actual device acoustic separation/echo behaviour, and provider/cloud speech are not verified by these fixtures. Media contents cannot grant host action consent: existing typed intent validation and separate trusted-host approval remain required. Do not describe the local fixture as third-party media integration or as solved acoustic attribution.
