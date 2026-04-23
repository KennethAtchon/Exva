use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub title: String,
    pub body: String,
    pub level: String,
}

pub fn notify(handle: &AppHandle, title: &str, body: &str, level: &str) {
    let payload = Notification {
        title: title.into(),
        body: body.into(),
        level: level.into(),
    };
    let _ = handle.emit("notification", payload);
}
