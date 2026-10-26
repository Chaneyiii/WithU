# D8 Local Proactivity Policy

D8 evaluates already-created, typed local candidates. It has no provider, network,
persistence, scheduler dispatch, or notification side effects. The server remains
responsible for deriving the owner and authorized scope, loading policy state,
and persisting eligible feed items.

## Rust API

`withu_proactivity::Policy::new(PolicyConfig)` validates a schema-version-1
policy. `Policy::evaluate(Candidate, now_unix_seconds, app_running)` returns
`Result<FeedItem, SuppressionReason>`. `Policy` is mutable because it tracks
dedupe keys and eligible deliveries for the configured rolling rate window.
Consent, pause, timezone, quiet hours, and rate-limit changes use
`update_config(config, expected_version)` with an expected version and exactly
incremented new config version; stale or malformed updates fail. `state()` and
`new_with_state(config, state)` let the owner persist dedupe keys, eligible times,
and clock ordering across restarts.

Each candidate includes its source, scope, unique dedupe key, creation and expiry
times, and feed content. Evaluation rejects disabled or paused policies, stopped
applications, invalid or future candidates, wrong scopes, expired candidates,
duplicates, quiet-hour candidates, and candidates above the rate limit. A stale
candidate is discarded after expiry; this crate does not queue catch-up delivery.

The timezone label is retained in policy for ownership and audit. The trusted
server supplies its current UTC offset in minutes, and the policy applies that
offset deterministically to quiet-hour calculations. This avoids host-local time
and daylight-saving database assumptions inside the pure policy crate. The owner
must refresh the offset when its timezone rules change.

`FeedItem::notification_projection()` always returns `NotificationProjection`
with title `Withu` and body `You have an update.`; it never copies candidate
text. The renderer feed item can retain its scoped content; the desktop layer
must use only this projection.

Contracts are in `contracts/v1/proactivity-policy.schema.json`,
`contracts/v1/proactive-candidate.schema.json`, and
`contracts/v1/proactive-feed-item.schema.json`. The crate intentionally does not
define delivery success: eligibility creates a feed item, not a claim that an OS
notification was shown.

## Application integration (2026-10-17)

The pure crate boundary above remains unchanged. Production owner persistence,
policy/feed RPCs, renderer controls and the Electron runner/notification projection
are now integrated (`40adfdb`, `6928f72`). Approved local D5 reminders can produce
due candidates while the app is running; policy still gates eligibility.
Notification state follows Electron events rather than assuming success from a
fixture or a call to show(). Real Windows notification center, Focus Assist,
permissions and long-running device behavior remain unverified.
