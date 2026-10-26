use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

static NEXT_CONTROLLER_ID: AtomicU64 = AtomicU64::new(1);

fn next_controller_id() -> Result<u64, ScheduleError> {
    let mut current = NEXT_CONTROLLER_ID.load(Ordering::Relaxed);
    loop {
        let next = current
            .checked_add(1)
            .ok_or(ScheduleError::LeaseExhausted)?;
        match NEXT_CONTROLLER_ID.compare_exchange_weak(
            current,
            next,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => return Ok(current),
            Err(actual) => current = actual,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduledTask {
    pub id: String,
    pub timezone: String,
    pub authorized: bool,
    pub paused: bool,
}

impl ScheduledTask {
    pub fn may_run(&self, app_running: bool) -> bool {
        self.authorized && !self.paused && app_running
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduleRequest {
    pub task_id: String,
    pub authorization_evidence_ref: String,
    pub scheduled_at: u64,
    pub timezone: String,
    pub authorized: bool,
    pub notification_conditions: Vec<String>,
    pub authorization_version: u64,
    pub cancel_token: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleStatus {
    Active,
    Paused,
    Deleted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduleRecord {
    pub schema_version: u16,
    pub task_id: String,
    pub authorization_evidence_ref: String,
    pub scheduled_at: u64,
    pub timezone: String,
    pub notification_conditions: Vec<String>,
    pub status: ScheduleStatus,
    pub version: u64,
    pub authorization_version: u64,
    pub cancel_token: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SchedulerLimits {
    pub schema_version: u16,
    pub max_concurrent: u32,
    pub budget_units: u64,
    pub max_retries: u32,
    pub rate_limit: u32,
    pub rate_window_seconds: u64,
}

impl SchedulerLimits {
    pub fn validate(self) -> Result<Self, ScheduleError> {
        if self.schema_version != 1
            || self.max_concurrent == 0
            || self.budget_units == 0
            || self.rate_limit == 0
            || self.rate_window_seconds == 0
        {
            return Err(ScheduleError::InvalidLimits);
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunLease {
    pub task_id: String,
    pub schedule_version: u64,
    pub cancel_token: String,
    pub budget_units: u64,
    controller_id: u64,
    lease_id: u128,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScheduleError {
    InvalidRequest,
    Duplicate,
    Missing,
    VersionConflict,
    Unauthorized,
    Paused,
    Deleted,
    AppStopped,
    ConcurrencyLimit,
    BudgetLimit,
    RateLimit,
    RetryLimit,
    InvalidLimits,
    LeaseMissing,
    LeaseExhausted,
}

#[derive(Clone, Debug)]
struct StoredSchedule {
    record: ScheduleRecord,
    attempts: u32,
}

pub struct ScheduleController {
    app_running: bool,
    limits: SchedulerLimits,
    active_runs: u32,
    budget_used: u64,
    window_started: u64,
    window_dispatches: u32,
    controller_id: u64,
    next_lease_id: u128,
    active_leases: HashMap<(u64, u128), (String, u64)>,
    schedules: HashMap<String, StoredSchedule>,
}

impl ScheduleController {
    pub fn new(limits: SchedulerLimits) -> Result<Self, ScheduleError> {
        let limits = limits.validate()?;
        let controller_id = next_controller_id()?;
        Ok(Self {
            app_running: true,
            limits,
            active_runs: 0,
            budget_used: 0,
            window_started: 0,
            window_dispatches: 0,
            controller_id,
            next_lease_id: 1,
            active_leases: HashMap::new(),
            schedules: HashMap::new(),
        })
    }

    pub fn limits(&self) -> SchedulerLimits {
        self.limits
    }

    pub fn set_limits(&mut self, limits: SchedulerLimits) -> Result<(), ScheduleError> {
        self.limits = limits.validate()?;
        Ok(())
    }

    pub fn set_app_running(&mut self, running: bool) {
        self.app_running = running;
    }

    pub fn app_running(&self) -> bool {
        self.app_running
    }

    pub fn create(&mut self, request: ScheduleRequest) -> Result<ScheduleRecord, ScheduleError> {
        if request.task_id.is_empty()
            || request.authorization_evidence_ref.is_empty()
            || request.scheduled_at == 0
            || request.timezone.trim().is_empty()
            || request.cancel_token.is_empty()
            || request.authorization_version == 0
            || !valid_timezone(&request.timezone)
        {
            return Err(ScheduleError::InvalidRequest);
        }
        if !request.authorized {
            return Err(ScheduleError::Unauthorized);
        }
        if self.schedules.contains_key(&request.task_id) {
            return Err(ScheduleError::Duplicate);
        }
        let record = ScheduleRecord {
            schema_version: 1,
            task_id: request.task_id.clone(),
            authorization_evidence_ref: request.authorization_evidence_ref,
            scheduled_at: request.scheduled_at,
            timezone: request.timezone,
            notification_conditions: request.notification_conditions,
            status: ScheduleStatus::Active,
            version: 1,
            authorization_version: request.authorization_version,
            cancel_token: request.cancel_token,
        };
        self.schedules.insert(
            request.task_id,
            StoredSchedule {
                record: record.clone(),
                attempts: 0,
            },
        );
        Ok(record)
    }

    pub fn pause(
        &mut self,
        task_id: &str,
        expected_version: u64,
    ) -> Result<ScheduleRecord, ScheduleError> {
        self.update_status(task_id, expected_version, ScheduleStatus::Paused)
    }

    pub fn resume(
        &mut self,
        task_id: &str,
        expected_version: u64,
    ) -> Result<ScheduleRecord, ScheduleError> {
        self.update_status(task_id, expected_version, ScheduleStatus::Active)
    }

    pub fn delete(
        &mut self,
        task_id: &str,
        expected_version: u64,
    ) -> Result<ScheduleRecord, ScheduleError> {
        self.update_status(task_id, expected_version, ScheduleStatus::Deleted)
    }

    pub fn revoke_authorization(
        &mut self,
        task_id: &str,
        expected_version: u64,
    ) -> Result<ScheduleRecord, ScheduleError> {
        let stored = self
            .schedules
            .get_mut(task_id)
            .ok_or(ScheduleError::Missing)?;
        if stored.record.version != expected_version {
            return Err(ScheduleError::VersionConflict);
        }
        stored.record.authorization_version = stored.record.authorization_version.saturating_add(1);
        stored.record.status = ScheduleStatus::Paused;
        stored.record.version = stored.record.version.saturating_add(1);
        Ok(stored.record.clone())
    }

    pub fn get(&self, task_id: &str) -> Option<&ScheduleRecord> {
        self.schedules.get(task_id).map(|stored| &stored.record)
    }

    pub fn begin_run(
        &mut self,
        task_id: &str,
        now: u64,
        budget_units: u64,
    ) -> Result<RunLease, ScheduleError> {
        if !self.app_running {
            return Err(ScheduleError::AppStopped);
        }
        if now.saturating_sub(self.window_started) >= self.limits.rate_window_seconds {
            self.window_started = now;
            self.window_dispatches = 0;
        }
        if self.window_dispatches >= self.limits.rate_limit {
            return Err(ScheduleError::RateLimit);
        }
        if self.active_runs >= self.limits.max_concurrent {
            return Err(ScheduleError::ConcurrencyLimit);
        }
        if budget_units == 0
            || self.budget_used.saturating_add(budget_units) > self.limits.budget_units
        {
            return Err(ScheduleError::BudgetLimit);
        }
        let stored = self
            .schedules
            .get_mut(task_id)
            .ok_or(ScheduleError::Missing)?;
        match stored.record.status {
            ScheduleStatus::Paused => return Err(ScheduleError::Paused),
            ScheduleStatus::Deleted => return Err(ScheduleError::Deleted),
            ScheduleStatus::Active => {}
        }
        if stored.record.authorization_evidence_ref.is_empty() {
            return Err(ScheduleError::Unauthorized);
        }
        stored.attempts = stored.attempts.saturating_add(1);
        if stored.attempts > self.limits.max_retries.saturating_add(1) {
            return Err(ScheduleError::RetryLimit);
        }
        let lease_id = self.next_lease_id;
        self.next_lease_id = self
            .next_lease_id
            .checked_add(1)
            .ok_or(ScheduleError::LeaseExhausted)?;
        self.active_leases.insert(
            (self.controller_id, lease_id),
            (task_id.to_owned(), stored.record.version),
        );
        self.active_runs = self.active_runs.saturating_add(1);
        self.budget_used = self.budget_used.saturating_add(budget_units);
        self.window_dispatches = self.window_dispatches.saturating_add(1);
        Ok(RunLease {
            task_id: task_id.into(),
            schedule_version: stored.record.version,
            cancel_token: stored.record.cancel_token.clone(),
            budget_units,
            controller_id: self.controller_id,
            lease_id,
        })
    }

    pub fn finish_run(&mut self, lease: RunLease) -> Result<(), ScheduleError> {
        let (task_id, schedule_version) = self
            .active_leases
            .remove(&(lease.controller_id, lease.lease_id))
            .ok_or(ScheduleError::LeaseMissing)?;
        self.active_runs = self.active_runs.saturating_sub(1);
        let stored = self.schedules.get(&task_id).ok_or(ScheduleError::Missing)?;
        if stored.record.version != schedule_version {
            return Err(ScheduleError::VersionConflict);
        }
        Ok(())
    }

    pub fn active_runs(&self) -> u32 {
        self.active_runs
    }

    pub fn budget_used(&self) -> u64 {
        self.budget_used
    }

    fn update_status(
        &mut self,
        task_id: &str,
        expected_version: u64,
        status: ScheduleStatus,
    ) -> Result<ScheduleRecord, ScheduleError> {
        let stored = self
            .schedules
            .get_mut(task_id)
            .ok_or(ScheduleError::Missing)?;
        if stored.record.version != expected_version {
            return Err(ScheduleError::VersionConflict);
        }
        if stored.record.status == ScheduleStatus::Deleted && status != ScheduleStatus::Deleted {
            return Err(ScheduleError::Deleted);
        }
        stored.record.status = status;
        stored.record.version = stored.record.version.saturating_add(1);
        Ok(stored.record.clone())
    }
}

fn valid_timezone(timezone: &str) -> bool {
    timezone == "UTC"
        || timezone.starts_with("Etc/")
        || timezone.contains('/')
            && timezone.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '+' | '-' | '/')
            })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits() -> SchedulerLimits {
        SchedulerLimits {
            schema_version: 1,
            max_concurrent: 1,
            budget_units: 10,
            max_retries: 1,
            rate_limit: 2,
            rate_window_seconds: 60,
        }
    }

    fn request() -> ScheduleRequest {
        ScheduleRequest {
            task_id: "schedule".into(),
            authorization_evidence_ref: "user-allow-1".into(),
            scheduled_at: 100,
            timezone: "Asia/Taipei".into(),
            authorized: true,
            notification_conditions: vec!["completed".into()],
            authorization_version: 1,
            cancel_token: "cancel-schedule".into(),
        }
    }

    #[test]
    fn no_work_after_app_exit_or_without_authorization() {
        let s = ScheduledTask {
            id: "schedule".into(),
            timezone: "Asia/Singapore".into(),
            authorized: true,
            paused: false,
        };
        assert!(s.may_run(true));
        assert!(!s.may_run(false));
        let off = ScheduledTask {
            authorized: false,
            ..s
        };
        assert!(!off.may_run(true));
    }

    #[test]
    fn lifecycle_and_cas_bound_pause_resume_delete() {
        let mut controller = ScheduleController::new(limits()).unwrap();
        let record = controller.create(request()).unwrap();
        assert_eq!(
            controller.pause("schedule", record.version).unwrap().status,
            ScheduleStatus::Paused
        );
        assert_eq!(
            controller.begin_run("schedule", 101, 1),
            Err(ScheduleError::Paused)
        );
        let record = controller.get("schedule").unwrap().clone();
        assert_eq!(
            controller
                .resume("schedule", record.version)
                .unwrap()
                .status,
            ScheduleStatus::Active
        );
        let record = controller.get("schedule").unwrap().clone();
        assert_eq!(
            controller
                .delete("schedule", record.version)
                .unwrap()
                .status,
            ScheduleStatus::Deleted
        );
        let record = controller.get("schedule").unwrap().clone();
        assert_eq!(
            controller.resume("schedule", record.version),
            Err(ScheduleError::Deleted)
        );
    }

    #[test]
    fn app_shutdown_concurrency_budget_rate_and_retry_are_gates() {
        let mut controller = ScheduleController::new(limits()).unwrap();
        controller.create(request()).unwrap();
        let lease = controller.begin_run("schedule", 100, 5).unwrap();
        assert_eq!(
            controller.begin_run("schedule", 100, 1),
            Err(ScheduleError::ConcurrencyLimit)
        );
        controller.finish_run(lease).unwrap();
        let lease = controller.begin_run("schedule", 100, 5).unwrap();
        controller.finish_run(lease).unwrap();
        assert_eq!(
            controller.begin_run("schedule", 100, 1),
            Err(ScheduleError::RateLimit)
        );
        assert_eq!(
            controller.begin_run("schedule", 200, 1),
            Err(ScheduleError::BudgetLimit)
        );
        controller.set_app_running(false);
        assert_eq!(
            controller.begin_run("schedule", 300, 1),
            Err(ScheduleError::AppStopped)
        );
    }

    #[test]
    fn stale_finish_releases_the_run_slot_after_schedule_cas_change() {
        let mut controller = ScheduleController::new(limits()).unwrap();
        let record = controller.create(request()).unwrap();
        let lease = controller.begin_run("schedule", 100, 1).unwrap();

        controller.pause("schedule", record.version).unwrap();
        assert_eq!(
            controller.finish_run(lease),
            Err(ScheduleError::VersionConflict)
        );
        assert_eq!(controller.active_runs(), 0);
    }

    #[test]
    fn finishing_a_lease_twice_cannot_release_another_run_slot() {
        let mut scheduler_limits = limits();
        scheduler_limits.max_concurrent = 2;
        let mut controller = ScheduleController::new(scheduler_limits).unwrap();
        controller.create(request()).unwrap();
        let mut second_request = request();
        second_request.task_id = "schedule-2".into();
        second_request.cancel_token = "cancel-schedule-2".into();
        controller.create(second_request).unwrap();

        let first = controller.begin_run("schedule", 100, 1).unwrap();
        let first_copy = first.clone();
        controller.begin_run("schedule-2", 100, 1).unwrap();
        assert_eq!(controller.active_runs(), 2);

        controller.finish_run(first).unwrap();
        assert_eq!(controller.active_runs(), 1);
        assert_eq!(
            controller.finish_run(first_copy),
            Err(ScheduleError::LeaseMissing)
        );
        assert_eq!(controller.active_runs(), 1);
    }

    #[test]
    fn lease_from_another_controller_cannot_release_an_active_run() {
        let mut previous = ScheduleController::new(limits()).unwrap();
        previous.create(request()).unwrap();
        let stale = previous.begin_run("schedule", 100, 1).unwrap();

        let mut current = ScheduleController::new(limits()).unwrap();
        current.create(request()).unwrap();
        let active = current.begin_run("schedule", 100, 1).unwrap();

        assert_eq!(current.finish_run(stale), Err(ScheduleError::LeaseMissing));
        assert_eq!(current.active_runs(), 1);
        current.finish_run(active).unwrap();
        assert_eq!(current.active_runs(), 0);
    }
}
