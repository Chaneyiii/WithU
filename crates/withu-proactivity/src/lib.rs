//! Deterministic, local eligibility policy for user-authorized proactive feed items.
//! This crate performs no provider calls, persistence, or notification delivery.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuietHours {
    pub start_minute: u16,
    pub end_minute: u16,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyConfig {
    pub schema_version: u16,
    pub version: u64,
    pub enabled: bool,
    pub scope: String,
    /// IANA timezone label used for display/audit; evaluation uses the explicit offset.
    pub timezone: String,
    pub utc_offset_minutes: i16,
    pub quiet_hours: Option<QuietHours>,
    pub paused: bool,
    pub rate_limit: u32,
    pub rate_window_seconds: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Candidate {
    pub schema_version: u16,
    pub id: String,
    pub source: String,
    pub scope: String,
    pub dedupe_key: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub title: String,
    pub body: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FeedItem {
    pub schema_version: u16,
    pub candidate_id: String,
    pub source: String,
    pub scope: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub title: String,
    pub body: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NotificationProjection {
    pub title: String,
    pub body: String,
}

impl FeedItem {
    /// Produces the OS-safe notification payload without exposing candidate content.
    pub fn notification_projection(&self) -> NotificationProjection {
        NotificationProjection {
            title: "Withu".into(),
            body: "You have an update.".into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SuppressionReason {
    Disabled,
    Paused,
    AppStopped,
    Expired,
    FutureCandidate,
    WrongScope,
    Duplicate,
    QuietHours,
    RateLimited,
    InvalidCandidate,
    ClockMovedBackwards,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PolicyError {
    InvalidConfig,
    VersionConflict,
    VersionExhausted,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyState {
    pub seen_dedupe_keys: Vec<String>,
    pub eligible_at: Vec<u64>,
    pub last_evaluated_at: Option<u64>,
}

pub struct Policy {
    config: PolicyConfig,
    seen_dedupe_keys: HashSet<String>,
    eligible_at: Vec<u64>,
    last_evaluated_at: Option<u64>,
}

impl Policy {
    pub fn new(config: PolicyConfig) -> Result<Self, PolicyError> {
        Self::new_with_state(config, PolicyState::default())
    }

    pub fn new_with_state(config: PolicyConfig, state: PolicyState) -> Result<Self, PolicyError> {
        validate_config(&config)?;
        Ok(Self {
            config,
            seen_dedupe_keys: state.seen_dedupe_keys.into_iter().collect(),
            eligible_at: state.eligible_at,
            last_evaluated_at: state.last_evaluated_at,
        })
    }

    pub fn config(&self) -> &PolicyConfig {
        &self.config
    }

    pub fn state(&self) -> PolicyState {
        let mut seen_dedupe_keys: Vec<_> = self.seen_dedupe_keys.iter().cloned().collect();
        seen_dedupe_keys.sort();
        PolicyState {
            seen_dedupe_keys,
            eligible_at: self.eligible_at.clone(),
            last_evaluated_at: self.last_evaluated_at,
        }
    }

    /// Replaces all policy settings using compare-and-swap on the policy version.
    pub fn update_config(
        &mut self,
        config: PolicyConfig,
        expected_version: u64,
    ) -> Result<(), PolicyError> {
        if self.config.version != expected_version {
            return Err(PolicyError::VersionConflict);
        }
        let expected_next = expected_version
            .checked_add(1)
            .ok_or(PolicyError::VersionExhausted)?;
        if config.version != expected_next {
            return Err(PolicyError::InvalidConfig);
        }
        validate_config(&config)?;
        self.config = config;
        Ok(())
    }

    /// Updates consent using compare-and-swap on the policy version.
    pub fn set_enabled(
        &mut self,
        enabled: bool,
        expected_version: u64,
        next_version: u64,
    ) -> Result<(), PolicyError> {
        self.update(expected_version, next_version, |config| {
            config.enabled = enabled
        })
    }

    pub fn set_paused(
        &mut self,
        paused: bool,
        expected_version: u64,
        next_version: u64,
    ) -> Result<(), PolicyError> {
        self.update(expected_version, next_version, |config| {
            config.paused = paused
        })
    }

    fn update(
        &mut self,
        expected_version: u64,
        next_version: u64,
        apply: impl FnOnce(&mut PolicyConfig),
    ) -> Result<(), PolicyError> {
        if self.config.version != expected_version {
            return Err(PolicyError::VersionConflict);
        }
        let expected_next = expected_version
            .checked_add(1)
            .ok_or(PolicyError::VersionExhausted)?;
        if next_version != expected_next {
            return Err(PolicyError::InvalidConfig);
        }
        apply(&mut self.config);
        self.config.version = next_version;
        Ok(())
    }

    /// Evaluates one typed local candidate. State tracks dedupe keys and successful
    /// eligibility decisions so repeated inputs cannot create duplicate feed items.
    pub fn evaluate(
        &mut self,
        candidate: Candidate,
        now: u64,
        app_running: bool,
    ) -> Result<FeedItem, SuppressionReason> {
        if self
            .last_evaluated_at
            .is_some_and(|previous| now < previous)
        {
            return Err(SuppressionReason::ClockMovedBackwards);
        }
        self.last_evaluated_at = Some(now);
        if !valid_candidate(&candidate) {
            return Err(SuppressionReason::InvalidCandidate);
        }
        if candidate.scope != self.config.scope {
            return Err(SuppressionReason::WrongScope);
        }
        // Every valid offer is a single attempt. Suppressed items are discarded,
        // so consent/quiet-hour changes cannot replay a backlog later.
        if !self.seen_dedupe_keys.insert(candidate.dedupe_key.clone()) {
            return Err(SuppressionReason::Duplicate);
        }
        if !self.config.enabled {
            return Err(SuppressionReason::Disabled);
        }
        if self.config.paused {
            return Err(SuppressionReason::Paused);
        }
        if !app_running {
            return Err(SuppressionReason::AppStopped);
        }
        if candidate.created_at > now {
            return Err(SuppressionReason::FutureCandidate);
        }
        if candidate.expires_at <= now {
            return Err(SuppressionReason::Expired);
        }
        if is_quiet(&self.config, now) {
            return Err(SuppressionReason::QuietHours);
        }
        let window_start = now.saturating_sub(self.config.rate_window_seconds);
        self.eligible_at
            .retain(|timestamp| *timestamp > window_start);
        if self.eligible_at.len() >= self.config.rate_limit as usize {
            return Err(SuppressionReason::RateLimited);
        }

        self.eligible_at.push(now);
        Ok(FeedItem {
            schema_version: 1,
            candidate_id: candidate.id,
            source: candidate.source,
            scope: candidate.scope,
            created_at: candidate.created_at,
            expires_at: candidate.expires_at,
            title: candidate.title,
            body: candidate.body,
        })
    }
}

fn validate_config(config: &PolicyConfig) -> Result<(), PolicyError> {
    let timezone_valid = !config.timezone.trim().is_empty()
        && (config.timezone == "UTC" || config.timezone.contains('/'))
        && config.timezone.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '+' | '-' | '/')
        });
    if config.schema_version != 1
        || config.version == 0
        || config.scope.trim().is_empty()
        || !timezone_valid
        || !(-14 * 60..=14 * 60).contains(&config.utc_offset_minutes)
        || config.rate_limit == 0
        || config.rate_window_seconds == 0
        || config.quiet_hours.as_ref().is_some_and(|quiet| {
            quiet.start_minute >= 24 * 60
                || quiet.end_minute >= 24 * 60
                || quiet.start_minute == quiet.end_minute
        })
    {
        return Err(PolicyError::InvalidConfig);
    }
    Ok(())
}

fn valid_candidate(candidate: &Candidate) -> bool {
    candidate.schema_version == 1
        && !candidate.id.trim().is_empty()
        && !candidate.source.trim().is_empty()
        && !candidate.scope.trim().is_empty()
        && !candidate.dedupe_key.trim().is_empty()
        && candidate.expires_at > candidate.created_at
}

fn is_quiet(config: &PolicyConfig, now: u64) -> bool {
    let Some(quiet) = &config.quiet_hours else {
        return false;
    };
    let offset_seconds = i64::from(config.utc_offset_minutes) * 60;
    let local_seconds = (now as i128 + i128::from(offset_seconds)).rem_euclid(86_400);
    let minute = (local_seconds / 60) as u16;
    if quiet.start_minute < quiet.end_minute {
        minute >= quiet.start_minute && minute < quiet.end_minute
    } else {
        minute >= quiet.start_minute || minute < quiet.end_minute
    }
}
