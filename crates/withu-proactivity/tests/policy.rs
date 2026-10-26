use withu_proactivity::{
    Candidate, Policy, PolicyConfig, PolicyError, QuietHours, SuppressionReason,
};

fn policy() -> Policy {
    Policy::new(PolicyConfig {
        schema_version: 1,
        version: 1,
        enabled: true,
        scope: "comfort:default".into(),
        timezone: "Asia/Taipei".into(),
        utc_offset_minutes: 480,
        quiet_hours: Some(QuietHours {
            start_minute: 22 * 60,
            end_minute: 7 * 60,
        }),
        paused: false,
        rate_limit: 2,
        rate_window_seconds: 3600,
    })
    .unwrap()
}

fn candidate(id: &str, created_at: u64, expires_at: u64) -> Candidate {
    Candidate {
        schema_version: 1,
        id: id.into(),
        source: "local_reminder".into(),
        scope: "comfort:default".into(),
        dedupe_key: id.into(),
        created_at,
        expires_at,
        title: "Private appointment details".into(),
        body: "Private memory must not reach the OS notification".into(),
    }
}

#[test]
fn disabled_consent_suppresses_candidate() {
    let mut policy = policy();
    policy.set_enabled(false, 1, 2).unwrap();
    assert_eq!(
        policy.evaluate(candidate("a", 1, 200_000), 2, true),
        Err(SuppressionReason::Disabled)
    );
}

#[test]
fn quiet_hours_use_explicit_timezone_offset() {
    let mut policy = policy();
    let utc_1500 = 15 * 60 * 60;
    assert_eq!(
        policy.evaluate(candidate("a", utc_1500 - 1, utc_1500 + 100), utc_1500, true),
        Err(SuppressionReason::QuietHours)
    );
}

#[test]
fn pause_suppresses_candidate() {
    let mut policy = policy();
    policy.set_paused(true, 1, 2).unwrap();
    assert_eq!(
        policy.evaluate(candidate("a", 100_000, 200_000), 100_001, true),
        Err(SuppressionReason::Paused)
    );
}

#[test]
fn stopped_application_suppresses_candidate() {
    assert_eq!(
        policy().evaluate(candidate("a", 100_000, 200_000), 100_001, false),
        Err(SuppressionReason::AppStopped)
    );
}

#[test]
fn expired_candidate_is_discarded_without_catch_up() {
    assert_eq!(
        policy().evaluate(candidate("a", 10, 20), 21, true),
        Err(SuppressionReason::Expired)
    );
}

#[test]
fn duplicate_dedupe_key_is_suppressed() {
    let mut policy = policy();
    assert!(policy
        .evaluate(candidate("same", 100_000, 200_000), 100_001, true)
        .is_ok());
    assert_eq!(
        policy.evaluate(candidate("same", 100_002, 200_000), 100_003, true),
        Err(SuppressionReason::Duplicate)
    );
}

#[test]
fn delivery_rate_limit_suppresses_excess_candidates() {
    let mut policy = policy();
    assert!(policy
        .evaluate(candidate("a", 100_000, 200_000), 100_001, true)
        .is_ok());
    assert!(policy
        .evaluate(candidate("b", 100_000, 200_000), 100_002, true)
        .is_ok());
    assert_eq!(
        policy.evaluate(candidate("c", 100_000, 200_000), 100_003, true),
        Err(SuppressionReason::RateLimited)
    );
}

#[test]
fn quiet_hours_cross_local_midnight_boundary() {
    let mut policy = policy();
    let utc_2230 = (22 * 60 + 30) * 60;
    assert_eq!(
        policy.evaluate(candidate("a", utc_2230 - 1, utc_2230 + 100), utc_2230, true),
        Err(SuppressionReason::QuietHours)
    );
}

#[test]
fn notification_projection_is_generic_and_does_not_copy_private_content() {
    let mut policy = policy();
    let item = policy
        .evaluate(candidate("a", 100_000, 200_000), 100_001, true)
        .unwrap();
    let notification = item.notification_projection();
    assert_eq!(notification.title, "Withu");
    assert_eq!(notification.body, "You have an update.");
    assert!(!notification.body.contains("Private"));
}

#[test]
fn candidate_scope_must_match_policy_scope() {
    let mut policy = policy();
    let mut candidate = candidate("a", 100_000, 200_000);
    candidate.scope = "comfort:other".into();
    assert_eq!(
        policy.evaluate(candidate, 100_001, true),
        Err(SuppressionReason::WrongScope)
    );
}

#[test]
fn policy_mutations_require_expected_version_and_exact_increment() {
    let mut policy = policy();
    assert_eq!(
        policy.set_paused(true, 0, 1),
        Err(PolicyError::VersionConflict)
    );
    assert_eq!(
        policy.set_paused(true, 1, 3),
        Err(PolicyError::InvalidConfig)
    );
    policy.set_paused(true, 1, 2).unwrap();
    assert_eq!(policy.config().version, 2);
    assert!(policy.config().paused);
}

#[test]
fn full_policy_update_is_version_checked_and_validated() {
    let mut policy = policy();
    let mut next = policy.config().clone();
    next.version = 2;
    next.utc_offset_minutes = -300;
    next.rate_limit = 4;
    policy.update_config(next, 1).unwrap();
    assert_eq!(policy.config().utc_offset_minutes, -300);
    assert_eq!(policy.config().rate_limit, 4);
}

#[test]
fn utc_timezone_label_is_valid() {
    let mut config = policy().config().clone();
    config.timezone = "UTC".into();
    assert!(Policy::new(config).is_ok());
}

#[test]
fn suppressed_candidate_is_discarded_after_resume() {
    let mut policy = policy();
    policy.set_paused(true, 1, 2).unwrap();
    assert_eq!(
        policy.evaluate(candidate("discarded", 100_000, 200_000), 100_001, true),
        Err(SuppressionReason::Paused)
    );
    policy.set_paused(false, 2, 3).unwrap();
    assert_eq!(
        policy.evaluate(candidate("discarded", 100_000, 200_000), 100_002, true),
        Err(SuppressionReason::Duplicate)
    );
}

#[test]
fn persisted_state_preserves_dedupe_across_policy_recreation() {
    let mut policy = policy();
    policy
        .evaluate(candidate("same", 100_000, 200_000), 100_001, true)
        .unwrap();
    let restored = Policy::new_with_state(policy.config().clone(), policy.state()).unwrap();
    let mut restored = restored;
    assert_eq!(
        restored.evaluate(candidate("same", 100_002, 200_000), 100_003, true),
        Err(SuppressionReason::Duplicate)
    );
}
