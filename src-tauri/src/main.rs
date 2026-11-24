mod engine;
mod protocol;

use engine::Engine;
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
    state: tauri::State<'_, AppState>,
) -> Result<EngineResponse, String> {
    state
        .0
        .lock()
        .map_err(|_| "Engine lock is unavailable".to_string())?
        .request(EngineRequest::simplify(expression))
}

fn main() {
    tauri::Builder::default()
        .manage(AppState(Mutex::new(Engine::new())))
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(app_data_dir)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![engine_health, engine_simplify])
        .run(tauri::generate_context!())
        .expect("failed to run MathForge");
}
