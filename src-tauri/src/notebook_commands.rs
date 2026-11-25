use crate::notebook::{
    LibrarySnapshot, NotebookDocument, NotebookFolder, NotebookSummary, SaveReceipt,
};
use crate::notebook_store::NotebookStore;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct NotebookState {
    store: Option<Arc<Mutex<NotebookStore>>>,
    startup_error: Option<String>,
}

impl NotebookState {
    pub fn ready(store: NotebookStore) -> Self {
        Self {
            store: Some(Arc::new(Mutex::new(store))),
            startup_error: None,
        }
    }

    pub fn unavailable(error: String) -> Self {
        Self {
            store: None,
            startup_error: Some(error),
        }
    }
}

async fn with_store<T, F>(state: State<'_, NotebookState>, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut NotebookStore) -> Result<T, String> + Send + 'static,
{
    let store = state.store.as_ref().cloned().ok_or_else(|| {
        format!(
            "Notebook storage could not be opened. Existing files were left untouched. {}",
            state
                .startup_error
                .as_deref()
                .unwrap_or("Unknown storage error.")
        )
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = store
            .lock()
            .map_err(|_| "Notebook library lock is unavailable".to_string())?;
        operation(&mut store)
    })
    .await
    .map_err(|error| format!("Notebook operation could not finish: {error}"))?
}

#[tauri::command]
pub async fn library_snapshot(
    query: Option<String>,
    state: State<'_, NotebookState>,
) -> Result<LibrarySnapshot, String> {
    with_store(state, move |store| {
        store.snapshot(query.as_deref().unwrap_or(""))
    })
    .await
}

#[tauri::command]
pub async fn create_notebook(
    title: String,
    state: State<'_, NotebookState>,
) -> Result<NotebookDocument, String> {
    with_store(state, move |store| store.create_notebook(title)).await
}

#[tauri::command]
pub async fn open_notebook(
    id: String,
    state: State<'_, NotebookState>,
) -> Result<NotebookDocument, String> {
    with_store(state, move |store| store.open_notebook(&id)).await
}

#[tauri::command]
pub async fn save_notebook(
    document: NotebookDocument,
    revision: u64,
    state: State<'_, NotebookState>,
) -> Result<SaveReceipt, String> {
    with_store(state, move |store| store.save_notebook(document, revision)).await
}

#[tauri::command]
pub async fn rename_notebook(
    id: String,
    title: String,
    state: State<'_, NotebookState>,
) -> Result<NotebookSummary, String> {
    with_store(state, move |store| store.rename_notebook(&id, &title)).await
}

#[tauri::command]
pub async fn delete_notebook(id: String, state: State<'_, NotebookState>) -> Result<(), String> {
    with_store(state, move |store| store.delete_notebook(&id)).await
}

#[tauri::command]
pub async fn set_notebook_favorite(
    id: String,
    favorite: bool,
    state: State<'_, NotebookState>,
) -> Result<(), String> {
    with_store(state, move |store| store.set_favorite(&id, favorite)).await
}

#[tauri::command]
pub async fn create_folder(
    title: String,
    state: State<'_, NotebookState>,
) -> Result<NotebookFolder, String> {
    with_store(state, move |store| store.create_folder(&title)).await
}

#[tauri::command]
pub async fn rename_folder(
    id: String,
    title: String,
    state: State<'_, NotebookState>,
) -> Result<(), String> {
    with_store(state, move |store| store.rename_folder(&id, &title)).await
}

#[tauri::command]
pub async fn delete_folder(id: String, state: State<'_, NotebookState>) -> Result<(), String> {
    with_store(state, move |store| store.delete_folder(&id)).await
}

#[tauri::command]
pub async fn move_notebook(
    id: String,
    folder_id: Option<String>,
    state: State<'_, NotebookState>,
) -> Result<(), String> {
    with_store(state, move |store| {
        store.move_notebook(&id, folder_id.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn import_notebook(
    source_path: String,
    state: State<'_, NotebookState>,
) -> Result<NotebookSummary, String> {
    with_store(state, move |store| {
        store.import_notebook(&PathBuf::from(source_path))
    })
    .await
}

#[tauri::command]
pub async fn export_notebook(
    id: String,
    destination: String,
    state: State<'_, NotebookState>,
) -> Result<String, String> {
    with_store(state, move |store| {
        store
            .export_notebook(&id, &PathBuf::from(destination))
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
}
