<div align="center">

# Withu

### A local-first desktop companion agent

English · [中文](README.md)

Conversations, reminders, schedules, drafts and memories stay on your own machine

<a href="docs/releases/freeze-v0.1-rc.4.md">Freeze record</a> · <a href="docs/manual-acceptance-2026-10-28.md">Acceptance</a> · <a href="docs/demo-acceptance-index.md">Doc index</a> · <a href="https://github.com/Chaneyiii/WithU/issues">Issues</a> · <a href="https://github.com/Chaneyiii/WithU/releases">Releases</a>

<p>
  <a href="https://github.com/Chaneyiii/WithU/commits/main"><img src="https://img.shields.io/github/last-commit/Chaneyiii/WithU?color=c4f042&labelColor=black&style=flat-square" alt="last commit"></a>
  <a href="https://github.com/Chaneyiii/WithU"><img src="https://img.shields.io/github/stars/Chaneyiii/WithU?labelColor=black&style=flat-square&color=ffcb47" alt="stars"></a>
  <a href="https://github.com/Chaneyiii/WithU/issues"><img src="https://img.shields.io/github/issues/Chaneyiii/WithU?labelColor=black&style=flat-square&color=ff80eb" alt="issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?labelColor=black&style=flat-square" alt="license"></a>
  <a href="https://github.com/Chaneyiii/WithU"><img src="https://img.shields.io/badge/version-v0.1--rc.4-369eff?labelColor=black&style=flat-square" alt="version"></a>
</p>

</div>

***

## What is Withu

Withu is a desktop companion that runs entirely on your machine. Electron draws the window, a **Rust server owns all persistence** (SQLite), and models are called through providers you configure yourself.

Unlike assistants that keep memory in the cloud, every reminder, schedule, draft, memory and tool call lives in a local database you can browse, edit and delete. The model only proposes; **writing anything requires your explicit consent**.

What it deliberately does not do: send messages on your behalf, reach the network silently, or invent an answer when it has no evidence.

## Why Withu

- **Model proposes, user decides.** Creating, editing and deleting reminders/schedules/drafts all go through an in-message approval card: allow once and it lands, cancel and nothing happens, repeated confirmation does not duplicate, a rescheduled card becomes invalid. → [Acceptance §1](docs/manual-acceptance-2026-10-28.md)
- **Honest degradation.** Unconfigured web search says so; a failed MCP App degrades to a text card instead of an empty frame; unavailable semantic search falls back and reports it. → [Evidence](docs/evidence/mcp-app-csp-blocked-2026-10-29.md)
- **Runtime apps run on their own origin.** MCP Apps are not loaded through `srcdoc` (which inherits the host CSP). They are served from a `withu-app:` privileged scheme: own origin, own CSP, released on hide, rebuilt on return. → [Rationale](docs/evidence/mcp-app-csp-blocked-2026-10-29.md)
- **Interruption is bounded.** Notifications carry generic text (no reminder content), quiet hours are configurable, and a fully quit app does nothing in the background. → [Acceptance §3–4](docs/manual-acceptance-2026-10-28.md)
- **Keys never touch the database.** Provider API keys live in Windows Credential Manager; config only stores a reference ID. → [Security](#security-and-privacy)

## Proof it works

Current version **`v0.1-rc.4`**; build commit and four hashes are in the [freeze record](docs/releases/freeze-v0.1-rc.4.md).

| Check | Result |
|---|---|
| Automated suites | All green: contracts 98 · chat:tools 14 · realtime:tools 11 · realtime-wire 9 · output-safety 25 · mcp:app 19 · mcp:client 10 · mcp:tools 10 · mcp:lifecycle 3 · chat:gui 5 · renderer 6 · product 357·276 · desktop 6/6 · packaged 6/6 |
| Manual device acceptance | notification toast / click returns to window / quiet hours / zero activity after quit / inline MCP App handshake / rebuild after 3s minimize — **6 of 6** |
| Packaging | Unsigned Windows build; all four SHA-256 values match the freeze record byte for byte |

Hashes and per-suite details are in freeze record §2 and §4; the six device checks are in the [acceptance table](docs/manual-acceptance-2026-10-28.md).

## Quick start

Windows, Rust/Cargo, Node.js 20+, Git.

```powershell
npm ci
npm run build     # Rust workspace + renderer, produces target\debug\withu-server.exe
npm start
```

Then open **Settings → Model** and add a provider (OpenAI-compatible endpoint, model name, API key). The key goes to Windows Credential Manager.

<details>
<summary>Windows setup troubleshooting</summary>

- vite/electron unusable after `npm ci` → npm blocked postinstall: `npm install-scripts approve esbuild electron`, then `npm rebuild`
- electron binary download fails → `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npx install-electron --no`
- checks read `target\debug\withu-server.exe` by default; point `WITHU_SERVER_BINARY` elsewhere if needed

</details>

### Packaging and device acceptance

```powershell
npm run package:windows     # writes output/p1/windows
npm run check:packaged      # six-scenario replay on the packaged app
```

MCP end to end: quit Withu completely, double-click `checks\run-with-mcp.cmd`, then say "用本地工具记一条注记：上课".
Expect `annotated:上课` plus a status line reading "本地 MCP App 已连接". Minimize for 3 seconds and restore — if the 4-character token inside the App changes, the session was released and rebuilt.

## Capabilities

| Capability | Status | Boundary |
|---|---|---|
| Text chat (Comfort) | ✅ | Streaming; system prompt carries current time and timezone |
| Reminders / schedules / drafts | ✅ | Always via approval card; cancel leaves no trace |
| Proactive reminders | ✅ | System notification + quiet hours; generic text |
| Memory | ✅ | Explicit save, tombstone on delete; degrades when semantic search is unavailable |
| Voice (Doubao full-duplex) | ✅ partial | Resumes local media after a call ends; real acoustics not verified |
| Inline MCP App | ✅ | Served by the `withu-app:` scheme; env-var configuration only |
| Web search | ⚠️ stub | Says so when unconfigured |

## Architecture

```
Electron main ──stdio──> withu-server (Rust)
     │                        │
     │  withu-app: scheme     ├─ SQLite (conversations / reminders / memory)
     ├─ inline MCP App        ├─ tool execution (propose → approve → commit)
     └─ window / tray / toast └─ Windows Credential Manager (API keys)
```

| Path | Responsibility |
|---|---|
| `apps/withu-server` | Local server: stdio lifecycle, SQLite, tool execution, credentials |
| `crates/` | Runtime / memory / speech / IPC domain boundaries |
| `client/withu-window` | Trusted main process: window, tray, MCP host and `withu-app:` protocol |
| `client/withu-preload` | Preload bridge (channel allowlist) |
| `client/withu-renderer` | React GUI |
| `client/withu-mcp-app` | MCP App host and demo view |
| `contracts/v1` | Versioned schemas, events, errors |
| `checks/` | Automated checks and local fixtures (no cloud access) |
| `docs/` | Evidence, release records, acceptance tables, repo audit |

## Checks

| Command | Coverage |
|---|---|
| `npm run check` | Contracts: schema / IPC / public config boundaries (98 schemas) |
| `npm run check:version` | Version string consistent in 5 places |
| `npm run check:chat:tools` / `check:realtime:tools` | Chat / realtime voice tool wire (14 / 11 groups) |
| `npm run check:mcp-app` / `check:mcp:client` / `check:mcp:tools` | MCP component, client, tool wire (19 / 10 / 10) |
| `npm run check:mcp:lifecycle` | Inline handshake / release on hide / rebuild (3 groups) |
| `npm run check:chat:gui` / `check:renderer` | GUI end to end (5) / renderer mapping (6) |
| `npm run check:product` | Source vs packaged consistency scan |
| `npm run check:desktop` / `check:packaged` | Six-scenario replay, dev and packaged |

## Documentation

- **Freeze and releases**: [freeze-v0.1-rc.4.md](docs/releases/freeze-v0.1-rc.4.md) · [releases/](docs/releases/)
- **Evidence**: [docs/evidence/](docs/evidence/) (notification delivery, CSP blocking, clock injection, dead-code decisions)
- **Device acceptance**: [manual-acceptance-2026-10-28.md](docs/manual-acceptance-2026-10-28.md)
- **Product authority**: [docs/product/withu-v3-spec.md](docs/product/withu-v3-spec.md)
- **Archive**: [docs/archive/README.md](docs/archive/README.md)

## Contributing

- **Issues**: bugs and feature requests are both welcome; include reproduction steps and the relevant evidence directory
- **Change flow**: add a failing assertion → fix → assertion turns green → repackage → update the hashes in the freeze record
- **Commits**: one concern per commit, message states symptom / root cause / verification
- See [CONTRIBUTING.md](CONTRIBUTING.md)

## Security and privacy

- API keys live only in Windows Credential Manager; the database stores reference IDs. No plaintext secrets in the repo or logs.
- Inline MCP Apps run in a `withu-app:` origin with `sandbox="allow-scripts"`: no same-origin access, no network capability.
- Network use and telemetry require explicit configuration; when unconfigured the app degrades honestly and never sends silently.
- Vulnerability reports: open an issue tagged `security`, without public exploit details.

## License

Apache License 2.0, see [LICENSE](LICENSE). Copyright © 2026 Withu contributors.

<details>
<summary>Earlier milestones (go1 → go5)</summary>

- [releases/v0.3.1go2.md](docs/releases/v0.3.1go2.md) · [go3](docs/releases/v0.3.1go3.md) · [go4](docs/releases/v0.3.1go4.md) · [go5](docs/releases/v0.3.1go5.md)
- Superseded handover and phase material lives in [docs/archive/](docs/archive/README.md)

</details>
