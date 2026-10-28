# Local Apps

> Capabilities need boundaries, and boundaries should be visible. Withu's local apps (MCP) keep every external ability behind a visible door: what is installed, what it can do, what it is doing — all in the open.

## What they are

- A local app is a standalone application living in the Withu drawer: message cards, calendar views, third-party tools — all plug in as apps (MCP standard).
- Each app has its own session and resource domain, isolated from the others. It cannot read your conversations or another app's data.
- Install and enable are your decisions. An unauthorized app is just a description page, not a capability.

## How authorization works

- Before an app acts, it files a **proposal**: what it will do, what it touches, who gets the result. You read it, tap "Allow," and only then does it move.
- High-impact actions confirm one by one; authorized low-risk actions do not nag repeatedly.
- Off means off: a disabled app's entrance quietly leaves, with nothing running behind.

## Boundaries

- App content is data, not instructions. Anything that tries to rewrite rules or bypass approvals through app content is ignored.
- Media, browser, and file apps work only inside the drawer sandbox; when the drawer closes, they rest.
- What is not possible is said honestly. Unconnected capabilities never masquerade as "coming soon" buttons.

> "Local" here means local for real: app sessions stay on this machine, credentials stay in the system credential store, and nothing passes third-party servers (except the ones you configure).

---

*app.md · Same system as soul.md.*
