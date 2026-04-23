//! OS keychain wrappers. Secrets never hit SQLite or logs — they live only in
//! the platform keychain (macOS Keychain, Windows Credential Manager, Linux
//! Secret Service).

use keyring::Entry;

use crate::error::AppResult;

const SERVICE: &str = "com.exva.app";

fn entry(key: &str) -> AppResult<Entry> {
    Ok(Entry::new(SERVICE, key)?)
}

pub fn set_secret(key: &str, value: &str) -> AppResult<()> {
    entry(key)?.set_password(value)?;
    Ok(())
}

pub fn get_secret(key: &str) -> AppResult<Option<String>> {
    match entry(key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_secret(key: &str) -> AppResult<()> {
    match entry(key)?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub mod keys {
    pub const ANTHROPIC_API_KEY: &str = "anthropic_api_key";
    pub const ALPACA_API_KEY: &str = "alpaca_api_key";
    pub const ALPACA_SECRET_KEY: &str = "alpaca_secret_key";
    pub const ALPACA_MODE: &str = "alpaca_mode";
    pub const BRAVE_API_KEY: &str = "brave_api_key";
    pub const TAVILY_API_KEY: &str = "tavily_api_key";
}
