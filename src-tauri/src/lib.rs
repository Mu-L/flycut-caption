mod commands;
mod models;

#[tauri::command]
fn app_ready() -> &'static str {
    "ok"
}

/// 弹出原生文件选择对话框，返回选中文件的本地路径。
/// 用于 FunASR Tauri 引擎等需要本地文件路径的场景。
#[tauri::command]
async fn pick_media_file() -> Option<String> {
    use rfd::AsyncFileDialog;

    let file = AsyncFileDialog::new()
        .add_filter(
            "Media files",
            &[
                "mp4", "webm", "mov", "avi", "mkv", "ogg",
                "mp3", "wav", "m4a", "flac", "aac",
            ],
        )
        .pick_file()
        .await;

    file.map(|f| f.path().to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            app_ready,
            pick_media_file,
            commands::asr::check_funasr_environment,
            commands::asr::transcribe_with_funasr,
            commands::model::list_available_models,
            commands::model::check_model_downloaded,
            commands::model::check_all_models_downloaded,
            commands::model::download_model,
            commands::model::download_all_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
