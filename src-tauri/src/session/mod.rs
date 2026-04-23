//! Session state machine. See System_Design.md §8.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use tauri::{AppHandle, Emitter};

use crate::db::Database;
use crate::types::SessionStatus;

pub struct SessionManager {
    pub db: Arc<Database>,
    pub handle: AppHandle,
    inner: RwLock<SessionState>,
}

#[derive(Debug, Clone)]
pub struct SessionState {
    pub status: SessionStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub portfolio_value: f64,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            status: SessionStatus::Idle,
            started_at: None,
            portfolio_value: 0.0,
        }
    }
}

impl SessionManager {
    pub fn new(db: Arc<Database>, handle: AppHandle) -> Self {
        Self {
            db,
            handle,
            inner: RwLock::new(SessionState::default()),
        }
    }

    pub fn snapshot(&self) -> SessionState {
        self.inner.read().clone()
    }

    pub fn status(&self) -> SessionStatus {
        self.inner.read().status
    }

    pub fn uptime_min(&self) -> i64 {
        match self.inner.read().started_at {
            Some(start) => (Utc::now() - start).num_minutes().max(0),
            None => 0,
        }
    }

    pub fn portfolio_value(&self) -> f64 {
        self.inner.read().portfolio_value
    }

    pub fn start(&self) -> SessionStatus {
        {
            let mut s = self.inner.write();
            s.status = SessionStatus::Active;
            if s.started_at.is_none() {
                s.started_at = Some(Utc::now());
            }
        }
        // TODO: spawn orchestrator tasks via `tokio::spawn` once implemented.
        let _ = self.handle.emit("session_started", ());
        self.status()
    }

    pub fn pause(&self) -> SessionStatus {
        self.inner.write().status = SessionStatus::Paused;
        self.status()
    }

    pub fn stop(&self) -> SessionStatus {
        self.inner.write().status = SessionStatus::Stopped;
        let _ = self.handle.emit("session_stopped", "user_requested");
        self.status()
    }
}
