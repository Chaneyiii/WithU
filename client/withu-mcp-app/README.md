# Withu local MCP App

Bundled local MCP server and App resource using the official ext-apps 2.0.3
and MCP 2.0 SDK. This is not a third-party connector. The registration helpers,
Client, AppBridge, App, and PostMessageTransport carry the actual protocol.

Mount `McpAppHost` from `withu-renderer/src/components/McpAppHost.jsx` in Comfort.
Optional `onClose` closes the view. Supply trusted
`proposalContext={{userEvidenceRef: submittedUserMessage.id,
goalDescription: submittedUserMessage.text}}` to propose a D4 action. Never use
assistant or App content as this context. D4 checks the durable user message,
Comfort scope, current target version, and exact goal text.

The App may only propose a `local_annotation` value up to 120 characters.
The host calls actionPreview, displays the server plan and approval outside
the iframe, waits for a human Allow once click, then calls actionDecide and
actionExecute. Only the server receipt can confirm an effect. Missing D4 RPC,
missing evidence, denial, closed sessions, and malformed results fail closed.
annotationGet supplies the current optimistic version when available.

The iframe permits scripts only, denies same-origin, popups, top navigation,
downloads and device permissions, with a random nonce CSP and no network.
The build plugin adds exact hashes for the bundled App script and styles to
the parent CSP (srcdoc inherits that policy). The host transport checks source,
opaque origin, active session, JSON-RPC schema and 64 KiB limit. Dimensions are
bounded. Unmount and reload revoke the session and close SDK transports.
Electron's frame policy rejects App navigation, and its window policy denies
popups. Protocol tests also exercise standard App resource teardown.

Run `npm test --workspace @withu/mcp-app-demo` and
`npm run test:browser --workspace @withu/mcp-app-demo`.
The browser test builds the actual component and runs Electron with sandbox,
context isolation and no Node integration. Third-party services and login have
not been tested. Successful local annotation requires the D4 RPC branch to be
integrated; this branch otherwise reports unavailable honestly.

To run the actual owner integration probe, set `WITHU_MCP_TEST_D4=1` and
`WITHU_D4_WORKTREE` to a checkout containing the D4 contracts, owner and built
server, then run the browser test. Optional `WITHU_SERVER_BINARY` overrides
its server path. This probe seeds a real submitted Comfort user message,
verifies no effect before the host Allow click, reads the committed SQLite
annotation and checks the same record after restarting the owner.
