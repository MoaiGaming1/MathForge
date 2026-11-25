mod engine;
mod notebook;
mod notebook_commands;
mod notebook_store;
mod protocol;

use engine::Engine;
use notebook_commands::NotebookState;
use protocol::{EngineRequest, EngineResponse};
use std::sync::Mutex;
use tauri::Manager;

struct AppState(Mutex<Engine>);

#[tauri::command]
fn engine_health(state: tauri::State<'_, AppState>) -> Result<EngineResponse, String> {
    state
        .0
        .lock()
        .map_err(|_| "Engine lock is unavailable".to_string())?
        .request(EngineRequest::health())
}

#[tauri::command]
fn engine_simplify(
    expression: String,
    context: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<EngineResponse, String> {
    state
        .0
        .lock()
        .map_err(|_| "Engine lock is unavailable".to_string())?
        .request(EngineRequest::simplify(expression, context))
}

#[tauri::command]
fn engine_visualize(
    operation: String,
    expression: String,
    options: serde_json::Value,
    context: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<EngineResponse, String> {
    state
        .0
        .lock()
        .map_err(|_| "Engine lock is unavailable".to_string())?
        .request(EngineRequest::visualize(operation, expression, options, context))
}

fn main() {
    tauri::Builder::default()
        .manage(AppState(Mutex::new(Engine::new())))
        .setup(|app| {
            let notebook_state = match app
                .path()
                .app_data_dir()
                .map_err(std::io::Error::other)
                .and_then(|app_data_dir| {
                    notebook_store::NotebookStore::open(app_data_dir).map_err(std::io::Error::other)
                }) {
                Ok(store) => NotebookState::ready(store),
                Err(error) => {
                    let message = error.to_string();
                    if message == notebook_store::INSTANCE_LOCK_ERROR {
                        app.handle().exit(0);
                    }
                    NotebookState::unavailable(message)
                }
            };
            app.manage(notebook_state);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            engine_health,
            engine_simplify,
            engine_visualize,
            notebook_commands::library_snapshot,
            notebook_commands::create_notebook,
            notebook_commands::open_notebook,
            notebook_commands::save_notebook,
            notebook_commands::rename_notebook,
            notebook_commands::delete_notebook,
            notebook_commands::set_notebook_favorite,
            notebook_commands::create_folder,
            notebook_commands::rename_folder,
            notebook_commands::delete_folder,
            notebook_commands::move_notebook,
            notebook_commands::import_notebook,
            notebook_commands::export_notebook
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MathForge");
}
