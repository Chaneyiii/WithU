use std::collections::BTreeMap;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub struct ResourceState {
    pub id: String,
    pub version: u64,
    pub status: &'static str,
    pub resource_kind: &'static str,
    pub test_only: bool,
    pub ticks: u64,
    pub worker_pid: Option<u32>,
}
struct Resource {
    state: ResourceState,
    started: Instant,
    duration: Duration,
    worker: Option<Child>,
    cleanup_failure: bool,
}
#[derive(Default)]
pub struct ResourceRegistry {
    entries: BTreeMap<String, Resource>,
}
impl ResourceRegistry {
    pub fn start_probe(
        &mut self,
        id: &str,
        duration_ms: u64,
        worker: bool,
        cleanup_failure: bool,
    ) -> Result<ResourceState, &'static str> {
        if self.entries.contains_key(id) {
            return Err("duplicate_resource");
        }
        let child = if worker {
            Some(
                Command::new(std::env::current_exe().map_err(|_| "worker_start_failed")?)
                    .arg("--resource-probe")
                    .stdin(Stdio::piped())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|_| "worker_start_failed")?,
            )
        } else {
            None
        };
        let state = ResourceState {
            id: id.into(),
            version: 1,
            status: "running",
            resource_kind: if worker { "worker" } else { "timer" },
            test_only: true,
            ticks: 0,
            worker_pid: child.as_ref().map(Child::id),
        };
        self.entries.insert(
            id.into(),
            Resource {
                state: state.clone(),
                started: Instant::now(),
                duration: Duration::from_millis(duration_ms),
                worker: child,
                cleanup_failure,
            },
        );
        Ok(state)
    }
    pub fn states(&self) -> Vec<ResourceState> {
        self.entries.values().map(|r| r.state.clone()).collect()
    }
    pub fn tick(&mut self) -> Vec<ResourceState> {
        let mut changes = vec![];
        for r in self.entries.values_mut() {
            if r.state.status == "running" {
                r.state.ticks += 1;
                if r.started.elapsed() >= r.duration {
                    r.state.version += 1;
                    r.state.status = if cleanup(r) { "completed" } else { "failed" };
                }
                changes.push(r.state.clone());
            }
        }
        changes
    }
    pub fn cancel(&mut self, id: &str, expected: u64) -> Result<ResourceState, &'static str> {
        let r = self.entries.get_mut(id).ok_or("resource_missing")?;
        if r.state.status == "cancelled" {
            return Ok(r.state.clone());
        }
        if r.state.version != expected {
            return Err("version_conflict");
        }
        if r.state.status != "running" {
            return Err("already_terminal");
        }
        r.state.status = if cleanup(r) { "cancelled" } else { "failed" };
        r.state.version += 1;
        Ok(r.state.clone())
    }
    pub fn shutdown(&mut self) -> bool {
        let mut released = true;
        for r in self.entries.values_mut() {
            if r.state.status == "running" {
                let ok = cleanup(r);
                r.state.status = if ok { "cancelled" } else { "failed" };
                r.state.version += 1;
                released &= ok;
            } else if r.state.status == "failed" {
                released = false;
            }
        }
        released
    }
}
impl Drop for ResourceRegistry {
    fn drop(&mut self) {
        self.shutdown();
    }
}
fn cleanup(r: &mut Resource) -> bool {
    let mut ok = true;
    if let Some(mut child) = r.worker.take() {
        drop(child.stdin.take());
        let deadline = Instant::now() + Duration::from_millis(750);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                _ => {
                    ok = false;
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
            }
        }
    }
    ok && !r.cleanup_failure
}
