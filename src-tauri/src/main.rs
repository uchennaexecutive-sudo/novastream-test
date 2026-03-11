#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::process::Command;
use tauri::Manager;
use tauri::Emitter;

#[tauri::command]
fn minimize_window(window: tauri::Window) {
    window.minimize().unwrap();
}

#[tauri::command]
fn toggle_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap() {
        window.unmaximize().unwrap();
    } else {
        window.maximize().unwrap();
    }
}

#[tauri::command]
fn close_window(window: tauri::Window) {
    window.close().unwrap();
}

#[tauri::command]
async fn download_update(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let current_exe = env::current_exe().map_err(|e| e.to_string())?;
    let update_dir = current_exe.parent().ok_or("No parent dir")?.join("_update");
    fs::create_dir_all(&update_dir).map_err(|e| e.to_string())?;
    let update_path = update_dir.join("nova-stream.exe");

    // Build client with connect + read timeouts
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    // Get content length for progress reporting
    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file_bytes: Vec<u8> = if total > 0 {
        Vec::with_capacity(total as usize)
    } else {
        Vec::new()
    };

    // Stream chunks and emit progress events
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        file_bytes.extend_from_slice(&chunk);

        if total > 0 {
            let percent = (downloaded * 100 / total) as u8;
            let _ = app.emit("download-progress", percent);
        }
    }

    // Emit 100% when complete
    let _ = app.emit("download-progress", 100u8);

    tokio::fs::write(&update_path, &file_bytes)
        .await
        .map_err(|e| e.to_string())?;

    Ok(update_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn apply_update() -> Result<(), String> {
    let current_exe = env::current_exe().map_err(|e| e.to_string())?;
    let current_path = current_exe.to_string_lossy().to_string();
    let update_exe = current_exe
        .parent().ok_or("No parent dir")?
        .join("_update")
        .join("nova-stream.exe");
    let update_path = update_exe.to_string_lossy().to_string();

    if !update_exe.exists() {
        return Err("Update file not found".to_string());
    }

    let batch_path = current_exe
        .parent().ok_or("No parent dir")?
        .join("_update.bat");

    let script = format!(
        "@echo off\r\n\
         timeout /t 2 /nobreak >nul\r\n\
         copy /y \"{}\" \"{}\" >nul\r\n\
         rmdir /s /q \"{}\" >nul 2>&1\r\n\
         start \"\" \"{}\"\r\n\
         del \"%~f0\" >nul 2>&1\r\n",
        update_path,
        current_path,
        current_exe.parent().unwrap().join("_update").to_string_lossy(),
        current_path,
    );

    fs::write(&batch_path, &script).map_err(|e| e.to_string())?;

    Command::new("cmd")
        .args(["/C", "start", "/min", "", &batch_path.to_string_lossy()])
        .spawn()
        .map_err(|e| e.to_string())?;

    std::process::exit(0)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            toggle_maximize,
            close_window,
            download_update,
            apply_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
