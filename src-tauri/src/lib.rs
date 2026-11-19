use tauri::{AppHandle, WebviewWindow};

/// Lets the OS take over the current mouse press so the whole window can be dragged.
#[tauri::command]
fn start_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|err| err.to_string())
}

/// Toggles the always-on-top flag of the widget window.
#[tauri::command]
fn set_always_on_top(window: WebviewWindow, enabled: bool) -> Result<bool, String> {
    window
        .set_always_on_top(enabled)
        .map_err(|err| err.to_string())?;
    Ok(enabled)
}

/// Closes the widget, removing it from the desktop.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_drag,
            set_always_on_top,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running metimes");
}
