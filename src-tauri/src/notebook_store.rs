use crate::notebook::{
    canonical_id, now_rfc3339, validate_title, LibrarySnapshot, NotebookDocument, NotebookFolder,
    NotebookSummary, RecoveryProblem, RecoveryReport, SaveReceipt, MAX_NOTEBOOK_BYTES,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;
use uuid::Uuid;

const DATABASE_FILE: &str = "library.sqlite3";
const INSTANCE_LOCK_FILE: &str = "library.instance-lock.sqlite3";
pub const INSTANCE_LOCK_ERROR: &str = "Another MathForge instance is already using this library.";

pub struct NotebookStore {
    notebooks_dir: PathBuf,
    _instance_lock: Connection,
    connection: Connection,
    save_revisions: std::collections::HashMap<String, u64>,
    recovery: RecoveryReport,
}

impl NotebookStore {
    pub fn open(app_data_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&app_data_dir).map_err(io_error)?;
        let instance_lock =
            Connection::open(app_data_dir.join(INSTANCE_LOCK_FILE)).map_err(db_error)?;
        instance_lock
            .busy_timeout(std::time::Duration::ZERO)
            .map_err(db_error)?;
        if let Err(error) = instance_lock.execute_batch("BEGIN EXCLUSIVE") {
            return match error {
                rusqlite::Error::SqliteFailure(code, _)
                    if matches!(
                        code.code,
                        rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
                    ) =>
                {
                    Err(INSTANCE_LOCK_ERROR.to_string())
                }
                error => Err(db_error(error)),
            };
        }

        let notebooks_dir = app_data_dir.join("notebooks");
        fs::create_dir_all(&notebooks_dir).map_err(io_error)?;
        let connection = Connection::open(app_data_dir.join(DATABASE_FILE)).map_err(db_error)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(db_error)?;
        let schema_version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(db_error)?;
        if schema_version > 1 {
            return Err(format!("Library database schema version {schema_version} is newer than this MathForge build."));
        }
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = FULL;
                 CREATE TABLE IF NOT EXISTS folders (
                   id TEXT PRIMARY KEY,
                   title TEXT NOT NULL,
                   created_at TEXT NOT NULL,
                   modified_at TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS notebooks (
                   id TEXT PRIMARY KEY,
                   title TEXT NOT NULL,
                   folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
                   file_location TEXT NOT NULL UNIQUE,
                   created_at TEXT NOT NULL,
                   modified_at TEXT NOT NULL,
                   last_opened_at TEXT,
                   favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1))
                 );
                 CREATE INDEX IF NOT EXISTS notebooks_folder_id_idx ON notebooks(folder_id);
                 CREATE INDEX IF NOT EXISTS notebooks_last_opened_idx ON notebooks(last_opened_at);
                 PRAGMA user_version = 1;",
            )
            .map_err(db_error)?;

        let mut store = Self {
            notebooks_dir,
            _instance_lock: instance_lock,
            connection,
            save_revisions: std::collections::HashMap::new(),
            recovery: RecoveryReport::default(),
        };
        store.recovery = store.recover()?;
        Ok(store)
    }

    pub fn snapshot(&self, query: &str) -> Result<LibrarySnapshot, String> {
        let mut notebooks = self.list_notebooks()?;
        let query = query.trim().to_lowercase();
        if !query.is_empty() {
            notebooks.retain(|notebook| notebook.title.to_lowercase().contains(&query));
        }
        Ok(LibrarySnapshot {
            notebooks,
            folders: self.list_folders()?,
            recovery: self.recovery.clone(),
        })
    }

    pub fn create_notebook(&mut self, title: String) -> Result<NotebookDocument, String> {
        let mut document = NotebookDocument::new(validate_title(&title)?);
        document.validate()?;
        let location = file_location(&document.id);
        let path = self.path_for_id(&document.id)?;
        let bytes = serialize_document(&document)?;
        atomic_write(&path, &bytes)?;
        let insert = self.connection.execute(
            "INSERT INTO notebooks (id, title, folder_id, file_location, created_at, modified_at, last_opened_at, favorite)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, NULL, 0)",
            params![document.id, document.title, location, document.created_at, document.modified_at],
        );
        if let Err(error) = insert {
            let _ = fs::remove_file(path);
            return Err(db_error(error));
        }
        self.save_revisions.insert(document.id.clone(), 0);
        Ok(document)
    }

    pub fn open_notebook(&mut self, id: &str) -> Result<NotebookDocument, String> {
        let id = canonical_id(id)?;
        let path = self.path_for_id(&id)?;
        let document = read_document(&path)?;
        if document.id != id {
            return Err("Notebook file ID does not match its library entry.".to_string());
        }
        let now = now_rfc3339();
        let changed = self
            .connection
            .execute(
                "UPDATE notebooks SET last_opened_at = ?1 WHERE id = ?2",
                params![now, id],
            )
            .map_err(db_error)?;
        if changed == 0 {
            return Err("Notebook is not in the library.".to_string());
        }
        Ok(document)
    }

    pub fn save_notebook(
        &mut self,
        mut document: NotebookDocument,
        revision: u64,
    ) -> Result<SaveReceipt, String> {
        document.validate()?;
        let id = document.id.clone();
        let last_revision = self.save_revisions.get(&id).copied().unwrap_or(0);
        let current_modified = self
            .connection
            .query_row(
                "SELECT modified_at FROM notebooks WHERE id = ?1",
                [&id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(db_error)?
            .ok_or_else(|| "Notebook is not in the library.".to_string())?;
        if revision < last_revision {
            return Ok(SaveReceipt {
                revision,
                modified_at: current_modified,
                stale: true,
            });
        }
        document.modified_at = now_rfc3339();
        self.persist_document(&document)?;
        self.save_revisions.insert(id, revision);
        Ok(SaveReceipt {
            revision,
            modified_at: document.modified_at,
            stale: false,
        })
    }

    pub fn rename_notebook(&mut self, id: &str, title: &str) -> Result<NotebookSummary, String> {
        let mut document = self.load_document(id)?;
        document.title = validate_title(title)?;
        document.modified_at = now_rfc3339();
        self.persist_document(&document)?;
        self.summary_for_id(&document.id)
    }

    pub fn delete_notebook(&mut self, id: &str) -> Result<(), String> {
        let id = canonical_id(id)?;
        let path = self.path_for_id(&id)?;
        let tombstone = self.notebooks_dir.join(format!("{id}.mathforge.deleting"));
        let moved_file = path.is_file();
        if moved_file {
            fs::rename(&path, &tombstone).map_err(io_error)?;
        }
        let result = self
            .connection
            .execute("DELETE FROM notebooks WHERE id = ?1", [&id]);
        match result {
            Ok(0) => {
                if moved_file {
                    let _ = fs::rename(&tombstone, &path);
                }
                Err("Notebook is not in the library.".to_string())
            }
            Ok(_) => {
                self.save_revisions.remove(&id);
                if moved_file {
                    fs::remove_file(&tombstone).map_err(|error| {
                        format!("Notebook was removed from the library, but its file could not be cleaned up: {error}")
                    })?;
                }
                Ok(())
            }
            Err(error) => {
                if moved_file {
                    let _ = fs::rename(&tombstone, &path);
                }
                Err(db_error(error))
            }
        }
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<(), String> {
        let id = canonical_id(id)?;
        let changed = self
            .connection
            .execute(
                "UPDATE notebooks SET favorite = ?1 WHERE id = ?2",
                params![favorite, id],
            )
            .map_err(db_error)?;
        require_one(changed, "Notebook is not in the library.")
    }

    pub fn create_folder(&self, title: &str) -> Result<NotebookFolder, String> {
        let title = validate_title(title)?;
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        self.connection
            .execute(
                "INSERT INTO folders (id, title, created_at, modified_at) VALUES (?1, ?2, ?3, ?4)",
                params![id, title, now, now],
            )
            .map_err(db_error)?;
        Ok(NotebookFolder {
            id,
            title,
            created_at: now.clone(),
            modified_at: now,
        })
    }

    pub fn rename_folder(&self, id: &str, title: &str) -> Result<(), String> {
        let id = canonical_id(id)?;
        let title = validate_title(title)?;
        let changed = self
            .connection
            .execute(
                "UPDATE folders SET title = ?1, modified_at = ?2 WHERE id = ?3",
                params![title, now_rfc3339(), id],
            )
            .map_err(db_error)?;
        require_one(changed, "Folder is not in the library.")
    }

    /// Deleting a folder always returns its notebooks to the unorganized library.
    pub fn delete_folder(&mut self, id: &str) -> Result<(), String> {
        let id = canonical_id(id)?;
        let transaction = self.connection.transaction().map_err(db_error)?;
        transaction
            .execute(
                "UPDATE notebooks SET folder_id = NULL WHERE folder_id = ?1",
                [&id],
            )
            .map_err(db_error)?;
        let deleted = transaction
            .execute("DELETE FROM folders WHERE id = ?1", [&id])
            .map_err(db_error)?;
        require_one(deleted, "Folder is not in the library.")?;
        transaction.commit().map_err(db_error)?;
        Ok(())
    }

    pub fn move_notebook(&self, id: &str, folder_id: Option<&str>) -> Result<(), String> {
        let id = canonical_id(id)?;
        let folder_id = folder_id.map(canonical_id).transpose()?;
        if let Some(folder_id) = folder_id.as_deref() {
            let exists: bool = self
                .connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM folders WHERE id = ?1)",
                    [folder_id],
                    |row| row.get(0),
                )
                .map_err(db_error)?;
            if !exists {
                return Err("Destination folder does not exist.".to_string());
            }
        }
        let changed = self
            .connection
            .execute(
                "UPDATE notebooks SET folder_id = ?1 WHERE id = ?2",
                params![folder_id, id],
            )
            .map_err(db_error)?;
        require_one(changed, "Notebook is not in the library.")
    }

    pub fn import_notebook(&mut self, source: &Path) -> Result<NotebookSummary, String> {
        if !source
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("mathforge"))
        {
            return Err("Choose a .mathforge notebook file.".to_string());
        }
        let mut document = read_document(source)?;
        let old_id = document.id.clone();
        let id_exists = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM notebooks WHERE id = ?1)",
                [&old_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(db_error)?;
        if id_exists || self.path_for_id(&old_id)?.exists() {
            document.id = Uuid::new_v4().to_string();
            document.modified_at = now_rfc3339();
        }
        let path = self.path_for_id(&document.id)?;
        let location = file_location(&document.id);
        let bytes = serialize_document(&document)?;
        atomic_write(&path, &bytes)?;
        let insert = self.connection.execute(
            "INSERT INTO notebooks (id, title, folder_id, file_location, created_at, modified_at, last_opened_at, favorite)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, NULL, 0)",
            params![document.id, document.title, location, document.created_at, document.modified_at],
        );
        if let Err(error) = insert {
            let _ = fs::remove_file(path);
            return Err(db_error(error));
        }
        self.summary_for_id(&document.id)
    }

    pub fn export_notebook(&self, id: &str, destination: &Path) -> Result<PathBuf, String> {
        let document = self.load_document(id)?;
        let source_path = self.path_for_id(&document.id)?;
        if same_existing_file(&source_path, destination) {
            return Err("Choose an export destination outside the library file.".to_string());
        }
        let mut destination = destination.to_path_buf();
        if destination.extension().and_then(|ext| ext.to_str()) != Some("mathforge") {
            destination.set_extension("mathforge");
        }
        let bytes = serialize_document(&document)?;
        atomic_write(&destination, &bytes)?;
        Ok(destination)
    }

    fn persist_document(&mut self, document: &NotebookDocument) -> Result<(), String> {
        let id = canonical_id(&document.id)?;
        let path = self.path_for_id(&id)?;
        let old_bytes = match fs::read(&path) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(io_error(error)),
        };
        let bytes = serialize_document(document)?;
        let transaction = self.connection.transaction().map_err(db_error)?;
        if let Err(error) = atomic_write(&path, &bytes) {
            return Err(error);
        }
        let changed = match transaction.execute(
            "UPDATE notebooks SET title = ?1, modified_at = ?2 WHERE id = ?3",
            params![document.title, document.modified_at, id],
        ) {
            Ok(changed) => changed,
            Err(error) => {
                drop(transaction);
                restore_file(&path, old_bytes.as_deref())?;
                return Err(db_error(error));
            }
        };
        if changed == 0 {
            drop(transaction);
            restore_file(&path, old_bytes.as_deref())?;
            return Err("Notebook is not in the library.".to_string());
        }
        if let Err(error) = transaction.commit() {
            restore_file(&path, old_bytes.as_deref())?;
            return Err(db_error(error));
        }
        Ok(())
    }

    fn load_document(&self, id: &str) -> Result<NotebookDocument, String> {
        let id = canonical_id(id)?;
        let path = self.path_for_id(&id)?;
        let document = read_document(&path)?;
        if document.id != id {
            return Err("Notebook file ID does not match its library entry.".to_string());
        }
        Ok(document)
    }

    fn list_notebooks(&self) -> Result<Vec<NotebookSummary>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, title, folder_id, file_location, created_at, modified_at, last_opened_at, favorite
                 FROM notebooks ORDER BY COALESCE(last_opened_at, '') DESC, modified_at DESC",
            )
            .map_err(db_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, bool>(7)?,
                ))
            })
            .map_err(db_error)?;
        let mut notebooks = Vec::new();
        for row in rows {
            let (id, title, folder_id, location, created_at, modified_at, last_opened_at, favorite) =
                row.map_err(db_error)?;
            let canonical_location = file_location(&id);
            let path = self.path_for_id(&id)?;
            notebooks.push(NotebookSummary {
                id,
                title,
                folder_id,
                file_location: location.clone(),
                created_at,
                modified_at,
                last_opened_at,
                favorite,
                missing: location != canonical_location || !path.is_file(),
            });
        }
        Ok(notebooks)
    }

    fn list_folders(&self) -> Result<Vec<NotebookFolder>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT id, title, created_at, modified_at FROM folders ORDER BY title COLLATE NOCASE")
            .map_err(db_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(NotebookFolder {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    modified_at: row.get(3)?,
                })
            })
            .map_err(db_error)?;
        rows.map(|row| row.map_err(db_error)).collect()
    }

    fn summary_for_id(&self, id: &str) -> Result<NotebookSummary, String> {
        self.list_notebooks()?
            .into_iter()
            .find(|notebook| notebook.id == id)
            .ok_or_else(|| "Notebook is not in the library.".to_string())
    }

    fn path_for_id(&self, id: &str) -> Result<PathBuf, String> {
        Ok(self
            .notebooks_dir
            .join(format!("{}.mathforge", canonical_id(id)?)))
    }

    fn recover(&mut self) -> Result<RecoveryReport, String> {
        let mut report = RecoveryReport::default();
        let entries = fs::read_dir(&self.notebooks_dir).map_err(io_error)?;
        let entries = entries.collect::<Result<Vec<_>, _>>().map_err(io_error)?;

        // A tombstone is a notebook moved aside immediately before deleting its index row.
        // Restore it whenever doing so cannot replace another file; the regular recovery pass
        // below will either reconcile its existing row or add an orphaned file back to the index.
        for entry in &entries {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let Some(id_part) = file_name.strip_suffix(".mathforge.deleting") else {
                continue;
            };
            let tombstone = entry.path();
            if !entry.file_type().map_err(io_error)?.is_file() {
                report.invalid.push(RecoveryProblem {
                    file: file_name,
                    message: "Deletion tombstone is not a regular file; it was left untouched."
                        .into(),
                });
                continue;
            }
            let mut document = match read_document(&tombstone) {
                Ok(document) => document,
                Err(message) => {
                    report.invalid.push(RecoveryProblem {
                        file: file_name,
                        message,
                    });
                    continue;
                }
            };
            let id = match canonical_id(id_part) {
                Ok(id) if id == document.id => id,
                _ => {
                    report.invalid.push(RecoveryProblem {
                        file: file_name,
                        message: "Deletion tombstone filename does not match its notebook UUID; it was left untouched.".into(),
                    });
                    continue;
                }
            };
            let path = self.path_for_id(&id)?;
            if path.exists() {
                report.invalid.push(RecoveryProblem {
                    file: file_name,
                    message: "A notebook file with this ID already exists; the tombstone was left untouched.".into(),
                });
                continue;
            }
            let indexed: bool = self
                .connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM notebooks WHERE id = ?1)",
                    [&id],
                    |row| row.get(0),
                )
                .map_err(db_error)?;
            fs::rename(&tombstone, &path).map_err(io_error)?;
            if indexed {
                report.recovered.push(format!(
                    "Restored {} after an interrupted deletion",
                    document.title
                ));
            }
            // Revalidation after parsing also canonicalizes the document before indexing.
            document.validate()?;
        }

        let entries = fs::read_dir(&self.notebooks_dir)
            .map_err(io_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io_error)?;
        for entry in entries {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if entry.path().extension().and_then(|ext| ext.to_str()) != Some("mathforge") {
                continue;
            }
            if !entry.file_type().map_err(io_error)?.is_file() {
                report.invalid.push(RecoveryProblem {
                    file: file_name,
                    message: "Notebook entry is not a regular file.".to_string(),
                });
                continue;
            }
            let mut document = match read_document(&entry.path()) {
                Ok(document) => document,
                Err(message) => {
                    report.invalid.push(RecoveryProblem {
                        file: file_name,
                        message,
                    });
                    continue;
                }
            };
            let expected_name = format!("{}.mathforge", document.id);
            if file_name != expected_name {
                report.invalid.push(RecoveryProblem {
                    file: file_name,
                    message: "Notebook filename does not match its UUID.".to_string(),
                });
                continue;
            }
            let exists: bool = self
                .connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM notebooks WHERE id = ?1)",
                    [&document.id],
                    |row| row.get(0),
                )
                .map_err(db_error)?;
            if exists {
                self.connection
                    .execute(
                        "UPDATE notebooks
                     SET title = ?1, created_at = ?2, modified_at = ?3, file_location = ?4
                     WHERE id = ?5",
                        params![
                            document.title,
                            document.created_at,
                            document.modified_at,
                            file_location(&document.id),
                            document.id
                        ],
                    )
                    .map_err(db_error)?;
                continue;
            }
            // Keep the file authoritative; its title and timestamps seed the recovered index entry.
            document.validate()?;
            let inserted = self.connection.execute(
                "INSERT INTO notebooks (id, title, folder_id, file_location, created_at, modified_at, last_opened_at, favorite)
                 VALUES (?1, ?2, NULL, ?3, ?4, ?5, NULL, 0)",
                params![document.id, document.title, file_location(&document.id), document.created_at, document.modified_at],
            );
            match inserted {
                Ok(_) => report.recovered.push(document.title),
                Err(error) => report.invalid.push(RecoveryProblem {
                    file: file_name,
                    message: format!("Could not add notebook to the library: {error}"),
                }),
            }
        }
        for notebook in self.list_notebooks()? {
            if notebook.missing {
                report
                    .missing
                    .push(format!("{} ({})", notebook.title, notebook.id));
            }
        }
        Ok(report)
    }
}

fn serialize_document(document: &NotebookDocument) -> Result<Vec<u8>, String> {
    let mut normalized = document.clone();
    normalized.validate()?;
    let bytes = serde_json::to_vec_pretty(&normalized).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_NOTEBOOK_BYTES {
        return Err(format!(
            "Notebook file exceeds the {} MiB limit.",
            MAX_NOTEBOOK_BYTES / 1024 / 1024
        ));
    }
    Ok(bytes)
}

fn read_document(path: &Path) -> Result<NotebookDocument, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("Could not read notebook file: {error}"))?;
    if metadata.len() as usize > MAX_NOTEBOOK_BYTES {
        return Err("Notebook file exceeds the 16 MiB limit.".to_string());
    }
    let file =
        File::open(path).map_err(|error| format!("Could not open notebook file: {error}"))?;
    let bytes = read_limited(file)?;
    let mut document: NotebookDocument = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Notebook file contains invalid JSON: {error}"))?;
    document.validate()?;
    Ok(document)
}

fn read_limited(reader: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_NOTEBOOK_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read notebook file: {error}"))?;
    if bytes.len() > MAX_NOTEBOOK_BYTES {
        return Err("Notebook file exceeds the 16 MiB limit.".to_string());
    }
    Ok(bytes)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "File destination has no parent directory.".to_string())?;
    if !parent.is_dir() {
        return Err("File destination directory does not exist.".to_string());
    }
    let mut temporary = NamedTempFile::new_in(parent).map_err(io_error)?;
    temporary.write_all(bytes).map_err(io_error)?;
    temporary.as_file().sync_all().map_err(io_error)?;
    temporary
        .persist(path)
        .map_err(|error| io_error(error.error))?;
    #[cfg(unix)]
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(io_error)?;
    Ok(())
}

fn restore_file(path: &Path, previous: Option<&[u8]>) -> Result<(), String> {
    if let Some(previous) = previous {
        atomic_write(path, previous)
    } else {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(io_error(error)),
        }
    }
}

fn file_location(id: &str) -> String {
    format!("notebooks/{id}.mathforge")
}

fn same_existing_file(source: &Path, destination: &Path) -> bool {
    match (fs::canonicalize(source), fs::canonicalize(destination)) {
        (Ok(source), Ok(destination)) => source == destination,
        _ => false,
    }
}

fn require_one(changed: usize, message: &str) -> Result<(), String> {
    if changed == 1 {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

fn io_error(error: impl std::fmt::Display) -> String {
    format!("File operation failed: {error}")
}

fn db_error(error: impl std::fmt::Display) -> String {
    format!("Library database operation failed: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notebook::{CellResult, CellType, NotebookCell};
    use std::fs;
    use tempfile::tempdir;

    fn store() -> (tempfile::TempDir, NotebookStore) {
        let directory = tempdir().unwrap();
        let store = NotebookStore::open(directory.path().to_path_buf()).unwrap();
        (directory, store)
    }

    fn document_with_cells() -> NotebookDocument {
        let mut document = NotebookDocument::new("Ordered notebook".to_string());
        document.cells = vec![
            NotebookCell {
                id: Uuid::new_v4().to_string(),
                order: 0,
                cell_type: CellType::Text,
                content: "Introduction".to_string(),
                result: None,
                visualization: Default::default(),
            },
            NotebookCell {
                id: Uuid::new_v4().to_string(),
                order: 1,
                cell_type: CellType::Mathematics,
                content: "x^2".to_string(),
                result: Some(CellResult {
                    exact: "x**2".to_string(),
                    latex: "x^{2}".to_string(),
                    calculated_at: now_rfc3339(),
                    approximate: false,
                    warning: None,
                }),
                visualization: Default::default(),
            },
            NotebookCell {
                id: Uuid::new_v4().to_string(),
                order: 2,
                cell_type: CellType::Markdown,
                content: "**Conclusion**".to_string(),
                result: None,
                visualization: Default::default(),
            },
        ];
        document
    }

    fn set_one_math_cell(document: &mut NotebookDocument, content: &str) {
        document.cells = vec![NotebookCell {
            id: Uuid::new_v4().to_string(), order: 0, cell_type: CellType::Mathematics,
            content: content.to_string(), result: None, visualization: Default::default(),
        }];
    }

    #[test]
    fn creates_and_reopens_notebook_preserving_order_types_and_results() {
        let (directory, mut store) = store();
        let mut document = store.create_notebook("Research".to_string()).unwrap();
        document.cells = document_with_cells().cells;
        let receipt = store.save_notebook(document.clone(), 1).unwrap();
        assert!(!receipt.stale);
        drop(store);
        let mut reopened = NotebookStore::open(directory.path().to_path_buf()).unwrap();
        let loaded = reopened.open_notebook(&document.id).unwrap();
        assert_eq!(loaded.cells, document.cells);
        assert_eq!(loaded.cells[0].cell_type, CellType::Text);
        assert_eq!(loaded.cells[1].cell_type, CellType::Mathematics);
        assert_eq!(loaded.cells[2].cell_type, CellType::Markdown);
        assert_eq!(loaded.cells[1].result.as_ref().unwrap().latex, "x^{2}");
    }

    #[test]
    fn assignment_and_function_sources_survive_notebook_save_and_reopen() {
        let (directory, mut store) = store();
        let mut document = store.create_notebook("Definitions".to_string()).unwrap();
        document.cells = vec!["a=5", "f(x)=sin(x)", "f(pi/2)"].into_iter().enumerate().map(|(order, content)| NotebookCell {
            id: Uuid::new_v4().to_string(),
            order: order as u32,
            cell_type: CellType::Mathematics,
            content: content.to_string(),
            result: None,
            visualization: Default::default(),
        }).collect();
        store.save_notebook(document.clone(), 1).unwrap();
        drop(store);
        let mut reopened = NotebookStore::open(directory.path().to_path_buf()).unwrap();
        let loaded = reopened.open_notebook(&document.id).unwrap();
        assert_eq!(loaded.cells.iter().map(|cell| cell.content.as_str()).collect::<Vec<_>>(), vec!["a=5", "f(x)=sin(x)", "f(pi/2)"]);
    }

    #[test]
    fn empty_single_and_multiple_cells_keep_ids_content_and_order_across_repeated_open_save() {
        let (directory, mut store) = store();
        let empty = store.create_notebook("Empty".to_string()).unwrap();
        assert!(empty.cells.is_empty());

        let mut document = store.create_notebook("Round trips".to_string()).unwrap();
        document.cells = vec!["a=3", "f(x)=a*x^2", "f(4)"].into_iter().enumerate().map(|(order, content)| NotebookCell {
            id: Uuid::new_v4().to_string(), order: order as u32,
            cell_type: CellType::Mathematics, content: content.to_string(), result: None,
            visualization: Default::default(),
        }).collect();
        let expected: Vec<_> = document.cells.iter().map(|cell| (cell.id.clone(), cell.content.clone(), cell.order)).collect();
        store.save_notebook(document.clone(), 1).unwrap();
        for revision in 2..=4 {
            drop(store);
            store = NotebookStore::open(directory.path().to_path_buf()).unwrap();
            document = store.open_notebook(&document.id).unwrap();
            assert_eq!(document.cells.iter().map(|cell| (cell.id.clone(), cell.content.clone(), cell.order)).collect::<Vec<_>>(), expected);
            store.save_notebook(document.clone(), revision).unwrap();
        }
        assert!(store.open_notebook(&empty.id).unwrap().cells.is_empty());

        let first_id = document.cells[0].id.clone();
        let inserted = NotebookCell { id: Uuid::new_v4().to_string(), order: 0, cell_type: CellType::Mathematics,
            content: "new=7".to_string(), result: None, visualization: Default::default() };
        document.cells.insert(1, inserted.clone());
        for (order, cell) in document.cells.iter_mut().enumerate() { cell.order = order as u32; }
        store.save_notebook(document.clone(), 5).unwrap();
        document = store.open_notebook(&document.id).unwrap();
        assert_eq!(document.cells[0].id, first_id);
        assert_eq!(document.cells[1].id, inserted.id);
        document.cells.remove(1);
        for (order, cell) in document.cells.iter_mut().enumerate() { cell.order = order as u32; }
        store.save_notebook(document.clone(), 6).unwrap();
        document = store.open_notebook(&document.id).unwrap();
        assert_eq!(document.cells.iter().map(|cell| cell.id.clone()).collect::<Vec<_>>(), expected.iter().map(|cell| cell.0.clone()).collect::<Vec<_>>());

        let single = store.create_notebook("Single seed".to_string()).unwrap();
        let mut single = single;
        set_one_math_cell(&mut single, "x=5");
        store.save_notebook(single.clone(), 1).unwrap();
        let reopened = store.open_notebook(&single.id).unwrap();
        assert_eq!(reopened.cells, single.cells);
    }

    #[test]
    fn renames_and_deletes_notebook_file_and_entry() {
        let (_directory, mut store) = store();
        let document = store.create_notebook("Before".to_string()).unwrap();
        assert_eq!(
            store.rename_notebook(&document.id, "After").unwrap().title,
            "After"
        );
        let path = store.path_for_id(&document.id).unwrap();
        store.delete_notebook(&document.id).unwrap();
        assert!(!path.exists());
        assert!(store.snapshot("").unwrap().notebooks.is_empty());
    }

    #[test]
    fn folder_crud_moves_notebooks_and_delete_unorganizes_contents() {
        let (_directory, mut store) = store();
        let document = store.create_notebook("Foldered".to_string()).unwrap();
        let folder = store.create_folder("Course").unwrap();
        store.move_notebook(&document.id, Some(&folder.id)).unwrap();
        assert_eq!(
            store.snapshot("").unwrap().notebooks[0]
                .folder_id
                .as_deref(),
            Some(folder.id.as_str())
        );
        store.rename_folder(&folder.id, "Class").unwrap();
        assert_eq!(store.snapshot("").unwrap().folders[0].title, "Class");
        store.delete_folder(&folder.id).unwrap();
        assert_eq!(store.snapshot("").unwrap().notebooks[0].folder_id, None);
        store.move_notebook(&document.id, None).unwrap();
    }

    #[test]
    fn favorites_and_title_search_work() {
        let (_directory, mut store) = store();
        let first = store.create_notebook("Algebra Basics".to_string()).unwrap();
        let _second = store.create_notebook("Geometry".to_string()).unwrap();
        store.set_favorite(&first.id, true).unwrap();
        let snapshot = store.snapshot("ALGEBRA").unwrap();
        assert_eq!(snapshot.notebooks.len(), 1);
        assert!(snapshot.notebooks[0].favorite);
        store.set_favorite(&first.id, false).unwrap();
        assert!(!store.summary_for_id(&first.id).unwrap().favorite);
    }

    #[test]
    fn import_rejects_invalid_and_future_versions_and_remaps_duplicate_ids() {
        let (directory, mut store) = store();
        let original = store.create_notebook("Imported".to_string()).unwrap();
        let source = directory.path().join("copy.mathforge");
        fs::copy(store.path_for_id(&original.id).unwrap(), &source).unwrap();
        let imported = store.import_notebook(&source).unwrap();
        assert_ne!(imported.id, original.id);

        let malformed = directory.path().join("malformed.mathforge");
        fs::write(&malformed, b"not json").unwrap();
        assert!(store
            .import_notebook(&malformed)
            .unwrap_err()
            .contains("invalid JSON"));

        let future = directory.path().join("future.mathforge");
        let mut future_doc = original.clone();
        future_doc.format_version = 99;
        fs::write(&future, serde_json::to_vec(&future_doc).unwrap()).unwrap();
        assert!(store
            .import_notebook(&future)
            .unwrap_err()
            .contains("Unsupported"));
    }

    #[test]
    fn export_can_be_reimported_without_changing_original() {
        let (directory, mut store) = store();
        let mut document = store.create_notebook("Portable".to_string()).unwrap();
        document.cells = document_with_cells().cells;
        document.settings.auto_calculate = false;
        document.settings.calculation_debounce_ms = 900;
        store.save_notebook(document.clone(), 1).unwrap();
        let target = directory.path().join("exported.mathforge");
        let exported = store.export_notebook(&document.id, &target).unwrap();
        let imported = store.import_notebook(&exported).unwrap();
        assert_ne!(imported.id, document.id);
        assert!(store.path_for_id(&document.id).unwrap().is_file());
        let exported_document = read_document(&exported).unwrap();
        assert_eq!(exported_document.id, document.id);
        assert_eq!(exported_document.cells, document.cells);
        assert_eq!(exported_document.settings, document.settings);
    }

    #[test]
    fn failed_atomic_replacement_keeps_existing_destination() {
        let directory = tempdir().unwrap();
        let destination = directory.path().join("occupied");
        fs::create_dir(&destination).unwrap();
        assert!(atomic_write(&destination, b"new data").is_err());
        assert!(destination.is_dir());
    }

    #[test]
    fn startup_recovers_unindexed_notebooks_and_reports_missing_files() {
        let directory = tempdir().unwrap();
        let notebooks_dir = directory.path().join("notebooks");
        fs::create_dir_all(&notebooks_dir).unwrap();
        let orphan = NotebookDocument::new("Recovered file".to_string());
        let orphan_path = notebooks_dir.join(format!("{}.mathforge", orphan.id));
        fs::write(&orphan_path, serde_json::to_vec_pretty(&orphan).unwrap()).unwrap();
        let mut initial = NotebookStore::open(directory.path().to_path_buf()).unwrap();
        assert_eq!(initial.recovery.recovered, vec!["Recovered file"]);
        let missing = initial.create_notebook("Missing file".to_string()).unwrap();
        fs::remove_file(initial.path_for_id(&missing.id).unwrap()).unwrap();
        drop(initial);
        let recovered = NotebookStore::open(directory.path().to_path_buf()).unwrap();
        assert_eq!(recovered.recovery.missing.len(), 1);
    }

    #[test]
    fn stale_save_revision_cannot_replace_newer_content() {
        let (_directory, mut store) = store();
        let mut document = store.create_notebook("Revision test".to_string()).unwrap();
        set_one_math_cell(&mut document, "new content");
        assert!(!store.save_notebook(document.clone(), 3).unwrap().stale);
        document.cells[0].content = "old content".to_string();
        assert!(store.save_notebook(document.clone(), 2).unwrap().stale);
        assert_eq!(
            store.load_document(&document.id).unwrap().cells[0].content,
            "new content"
        );
    }

    #[test]
    fn failed_metadata_update_restores_last_saved_file() {
        let (_directory, mut store) = store();
        let mut document = store
            .create_notebook("Atomic metadata".to_string())
            .unwrap();
        set_one_math_cell(&mut document, "old value");
        let path = store.path_for_id(&document.id).unwrap();
        let previous = fs::read(&path).unwrap();
        store
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_notebook_update BEFORE UPDATE ON notebooks
             BEGIN SELECT RAISE(ABORT, 'injected metadata failure'); END;",
            )
            .unwrap();
        document.cells[0].content = "new value".to_string();
        assert!(store.save_notebook(document, 1).is_err());
        assert_eq!(fs::read(path).unwrap(), previous);
    }

    #[test]
    fn opening_a_notebook_records_it_as_recent() {
        let (_directory, mut store) = store();
        let document = store.create_notebook("Recent item".to_string()).unwrap();
        assert!(store.snapshot("").unwrap().notebooks[0]
            .last_opened_at
            .is_none());
        store.open_notebook(&document.id).unwrap();
        assert!(store.snapshot("").unwrap().notebooks[0]
            .last_opened_at
            .is_some());
    }

    #[test]
    fn second_library_instance_is_rejected_and_lock_releases_on_drop() {
        if let (Ok(path), Ok(mode)) = (
            std::env::var("MATHFORGE_LOCK_TEST_PATH"),
            std::env::var("MATHFORGE_LOCK_TEST_MODE"),
        ) {
            let result = NotebookStore::open(PathBuf::from(path));
            match mode.as_str() {
                "expect-locked" => assert_eq!(result.err().as_deref(), Some(INSTANCE_LOCK_ERROR)),
                "acquire-and-exit" => {
                    assert!(result.is_ok());
                    // Model abnormal termination: SQLite must release the OS lock even though
                    // Rust destructors, including the connection destructor, do not run.
                    std::process::exit(0);
                }
                _ => panic!("unknown lock test mode"),
            }
            return;
        }

        let directory = tempdir().unwrap();
        let store = NotebookStore::open(directory.path().to_path_buf()).unwrap();
        let run_child = |mode: &str| {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "notebook_store::tests::second_library_instance_is_rejected_and_lock_releases_on_drop",
                    "--nocapture",
                ])
                .env("MATHFORGE_LOCK_TEST_PATH", directory.path())
                .env("MATHFORGE_LOCK_TEST_MODE", mode)
                .status()
                .unwrap()
        };
        assert!(run_child("expect-locked").success());
        drop(store);
        assert!(run_child("acquire-and-exit").success());
        assert!(NotebookStore::open(directory.path().to_path_buf()).is_ok());
    }

    #[test]
    fn startup_reconciles_stale_database_metadata_from_notebook_file() {
        let (directory, mut store) = store();
        let document = store.create_notebook("File title".to_string()).unwrap();
        store.connection.execute(
            "UPDATE notebooks SET title = 'Stale title', modified_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
            [&document.id],
        ).unwrap();
        drop(store);
        let recovered = NotebookStore::open(directory.path().to_path_buf()).unwrap();
        let summary = recovered.summary_for_id(&document.id).unwrap();
        assert_eq!(summary.title, document.title);
        assert_eq!(summary.modified_at, document.modified_at);
    }

    #[test]
    fn startup_restores_tombstone_when_database_still_references_notebook() {
        let (directory, mut store) = store();
        let document = store
            .create_notebook("Interrupted delete".to_string())
            .unwrap();
        let path = store.path_for_id(&document.id).unwrap();
        let tombstone = store
            .notebooks_dir
            .join(format!("{}.mathforge.deleting", document.id));
        fs::rename(&path, &tombstone).unwrap();
        drop(store);
        let recovered = NotebookStore::open(directory.path().to_path_buf()).unwrap();
        assert!(recovered.path_for_id(&document.id).unwrap().is_file());
        assert!(recovered.load_document(&document.id).is_ok());
        assert!(recovered
            .recovery
            .recovered
            .iter()
            .any(|item| item.contains("interrupted deletion")));
    }

    #[test]
    fn startup_recovers_tombstone_when_database_row_was_already_removed() {
        let (directory, mut store) = store();
        let document = store
            .create_notebook("Orphan tombstone".to_string())
            .unwrap();
        let path = store.path_for_id(&document.id).unwrap();
        let tombstone = store
            .notebooks_dir
            .join(format!("{}.mathforge.deleting", document.id));
        fs::rename(&path, &tombstone).unwrap();
        store
            .connection
            .execute("DELETE FROM notebooks WHERE id = ?1", [&document.id])
            .unwrap();
        drop(store);
        let recovered = NotebookStore::open(directory.path().to_path_buf()).unwrap();
        assert!(recovered.load_document(&document.id).is_ok());
        assert_eq!(recovered.snapshot("").unwrap().notebooks.len(), 1);
    }

    #[test]
    fn import_accepts_uppercase_extension() {
        let (directory, mut store) = store();
        let document = store
            .create_notebook("Uppercase extension".to_string())
            .unwrap();
        let source = directory.path().join("notebook.MATHFORGE");
        fs::copy(store.path_for_id(&document.id).unwrap(), &source).unwrap();
        assert!(store.import_notebook(&source).is_ok());
    }

    #[test]
    fn import_reader_enforces_size_limit_while_reading() {
        let oversized = std::io::Cursor::new(vec![0; MAX_NOTEBOOK_BYTES + 1]);
        assert!(read_limited(oversized)
            .unwrap_err()
            .contains("exceeds the 16 MiB limit"));
    }

    #[test]
    fn export_reads_the_document_after_pending_autosave_completes() {
        let (directory, mut store) = store();
        let mut document = store.create_notebook("Pending export".to_string()).unwrap();
        set_one_math_cell(&mut document, "latest autosaved expression");
        store.save_notebook(document.clone(), 1).unwrap();
        let destination = directory.path().join("latest.mathforge");
        let exported = store.export_notebook(&document.id, &destination).unwrap();
        assert_eq!(
            read_document(&exported).unwrap().cells[0].content,
            "latest autosaved expression"
        );
    }
}
