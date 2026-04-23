use std::path::Path;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use refinery::embed_migrations;

use crate::error::{AppError, AppResult};

pub mod agent_runs;
pub mod events;
pub mod session;
pub mod stats;
pub mod trades;

embed_migrations!("./migrations");

pub type SqlitePool = Pool<SqliteConnectionManager>;
pub type PooledConn = r2d2::PooledConnection<SqliteConnectionManager>;

pub struct Database {
    pool: SqlitePool,
}

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        let manager = SqliteConnectionManager::file(path).with_init(|c| {
            c.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        });
        let pool = Pool::builder().max_size(8).build(manager)?;
        Ok(Self { pool })
    }

    pub fn run_migrations(&self) -> AppResult<()> {
        let mut conn = self.conn()?;
        migrations::runner()
            .run(&mut *conn)
            .map_err(|e| AppError::Migration(e.to_string()))?;
        Ok(())
    }

    pub fn conn(&self) -> AppResult<PooledConn> {
        Ok(self.pool.get()?)
    }
}
