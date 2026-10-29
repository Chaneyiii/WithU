<div align="center">

# Withu

### A local-first desktop companion agent

Conversations, reminders, schedules, drafts and memories stay on your own machine

English · [中文](README.md)

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?labelColor=black&style=flat-square" alt="license"></a>
  <a href="https://github.com/Chaneyiii/WithU"><img src="https://img.shields.io/badge/version-v0.1--rc.4-369eff?labelColor=black&style=flat-square" alt="version"></a>
</p>

</div>

***

## Overview

Withu is a desktop companion that runs entirely on your machine. Electron handles the window and interaction, a Rust server owns persistence and tool execution, data lives in a local SQLite database, and models are called through providers you configure yourself.

Reminders, schedules, drafts, memories and every tool call are recorded locally and can be viewed, edited and deleted from the interface. The model only proposes; writing anything requires your explicit approval on an approval card.

## Features

- **Chat**: streaming replies with the current time and timezone injected into the system prompt.
- **Reminders, schedules and drafts**: written after approval, with rescheduling, cancellation and deletion.
- **Proactive reminders**: system notifications at the scheduled time, with quiet hours.
- **Memory**: explicit saving and deletion, with semantic retrieval.
- **Voice calls**: Doubao full-duplex realtime voice.
- **MCP Apps**: third-party apps run inline from their own origin, released on hide and rebuilt on return.
- **Local first**: data and keys stay on your machine; API keys are stored in Windows Credential Manager.

## Quick start

Requires Windows 10/11 x64, Node.js 20 or newer, Rust with Cargo, and Git.

```powershell
npm ci
npm run build
npm start
```

On first launch, open **Settings → General** and fill in the provider endpoint, model name and API key under "Model & Voice".

## Project layout

```mermaid
flowchart LR
    R["client/withu-renderer<br/>Interface · React"]
    P["client/withu-preload<br/>Preload bridge · channel allowlist"]
    W["client/withu-window<br/>Main process · window · tray · MCP host"]
    M["client/withu-mcp-app<br/>Inline MCP App host · sandboxed iframe"]
    S["apps/withu-server<br/>Rust server · lifecycle · tool execution"]
    C["crates/*<br/>Domain modules · runtime · memory · speech · scheduling"]
    K["contracts/v1<br/>Data contracts · events · errors"]
    DB[("SQLite")]
    CM[("Windows Credential Manager")]

    R <-->|IPC| P
    P <-->|allowlisted channels| W
    W <-->|withu-app: protocol| M
    W <-->|stdio| S
    W -.->|client/withu-ipc| K
    S -.->|crates/withu-ipc| K
    S ---|read / write| DB
    S -.->|credential reference| CM
    S --> C
```

## Security and privacy

- API keys live only in Windows Credential Manager; the database stores reference IDs.
- Inline MCP Apps run in their own origin and CSP, with no same-origin access and no network capability.
- Data stays on your machine; network access requires explicit configuration.

## License

Released under the [Apache License 2.0](LICENSE).

Copyright © 2026 Withu contributors
