//! Mailbox transports: shared storage where each device drops its bundles
//! into its own folder and reads the other devices' folders. Layout:
//! `<group>/<device id>/<from>-<to>.kzb`.

use std::path::PathBuf;

use crate::error::Result;

pub trait Mailbox {
    /// Stable name, used for this device's send cursor and the sync log.
    fn name(&self) -> &str;
    /// Device ids with a folder in the group.
    fn devices(&self, group: &str) -> Result<Vec<String>>;
    /// Bundle file names in a device's folder.
    fn list(&self, group: &str, device: &str) -> Result<Vec<String>>;
    fn get(&self, group: &str, device: &str, file: &str) -> Result<Vec<u8>>;
    fn put(&self, group: &str, device: &str, file: &str, bytes: &[u8]) -> Result<()>;
    /// Removes one of this device's own bundles (after compaction).
    fn delete(&self, group: &str, device: &str, file: &str) -> Result<()>;
}

/// A local folder, e.g. one kept in step by Syncthing, or for tests.
pub struct FolderMailbox {
    pub root: PathBuf,
}

fn names(dir: PathBuf, want_dirs: bool) -> Result<Vec<String>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() == want_dirs
            && let Some(name) = entry.file_name().to_str()
        {
            out.push(name.to_string());
        }
    }
    out.sort();
    Ok(out)
}

impl Mailbox for FolderMailbox {
    fn name(&self) -> &str {
        "folder"
    }

    fn devices(&self, group: &str) -> Result<Vec<String>> {
        names(self.root.join(group), true)
    }

    fn list(&self, group: &str, device: &str) -> Result<Vec<String>> {
        Ok(names(self.root.join(group).join(device), false)?
            .into_iter()
            .filter(|n| n.ends_with(".kzb"))
            .collect())
    }

    fn get(&self, group: &str, device: &str, file: &str) -> Result<Vec<u8>> {
        Ok(std::fs::read(
            self.root.join(group).join(device).join(file),
        )?)
    }

    fn put(&self, group: &str, device: &str, file: &str, bytes: &[u8]) -> Result<()> {
        let dir = self.root.join(group).join(device);
        std::fs::create_dir_all(&dir)?;
        let tmp = dir.join(format!("{file}.tmp"));
        std::fs::write(&tmp, bytes)?;
        std::fs::rename(tmp, dir.join(file))?;
        Ok(())
    }

    fn delete(&self, group: &str, device: &str, file: &str) -> Result<()> {
        let path = self.root.join(group).join(device).join(file);
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }
}
