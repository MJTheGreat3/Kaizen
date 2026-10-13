use std::path::Path;
use std::sync::OnceLock;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

use crate::error::Result;

static GUARD: OnceLock<WorkerGuard> = OnceLock::new();

const FILE_PREFIX: &str = "kaizen.log";

/// Logs to stdout and to a daily rotating file in `log_dir` (last 7 kept).
pub fn init(log_dir: &Path) {
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix(FILE_PREFIX)
        .max_log_files(7)
        .build(log_dir);
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let registry = tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer());
    match appender {
        Ok(appender) => {
            let (writer, guard) = tracing_appender::non_blocking(appender);
            let _ = GUARD.set(guard);
            let _ = registry
                .with(fmt::layer().with_ansi(false).with_writer(writer))
                .try_init();
        }
        Err(e) => {
            let _ = registry.try_init();
            tracing::error!("file logging disabled: {e}");
        }
    }
}

/// Returns the last `lines` lines of the newest log file.
pub fn tail(log_dir: &Path, lines: usize) -> Result<String> {
    let newest = std::fs::read_dir(log_dir)?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(FILE_PREFIX))
        .max_by_key(|e| e.file_name());
    let Some(file) = newest else {
        return Ok(String::new());
    };
    let content = std::fs::read_to_string(file.path())?;
    let all: Vec<&str> = content.lines().collect();
    Ok(all[all.len().saturating_sub(lines)..].join("\n"))
}
