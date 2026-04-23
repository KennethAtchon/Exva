use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("connection pool: {0}")]
    Pool(#[from] r2d2::Error),

    #[error("migration: {0}")]
    Migration(String),

    #[error("keychain: {0}")]
    Keychain(#[from] keyring::Error),

    #[error("http: {0}")]
    Http(#[from] reqwest::Error),

    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("broker: {0}")]
    Broker(String),

    #[error("agent: {0}")]
    Agent(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid: {0}")]
    Invalid(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("other: {0}")]
    Other(String),
}

pub type AppResult<T> = Result<T, AppError>;

// Tauri command serializer — we ship error as a tagged string so the frontend
// can render it without guessing at shape.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<refinery::Error> for AppError {
    fn from(e: refinery::Error) -> Self {
        AppError::Migration(e.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Other(e.to_string())
    }
}
