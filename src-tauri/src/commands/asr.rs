use crate::models::transcript::TranscriptResult;
use std::process::Command;
use tauri::AppHandle;
use tauri::Manager;

fn required_model_files(model_id: &str) -> &'static [&'static str] {
    match model_id {
        "sensevoice-small-int8" | "paraformer-small-int8" => &["model.int8.onnx", "tokens.txt"],
        _ => &["model.int8.onnx", "tokens.txt"],
    }
}

fn validate_model_dir(model_dir: &std::path::Path, model_id: &str) -> Result<(), String> {
    let missing: Vec<&str> = required_model_files(model_id)
        .iter()
        .copied()
        .filter(|file| !model_dir.join(file).is_file())
        .collect();

    if missing.is_empty() {
        return Ok(());
    }

    Err(format!(
        "FunASR 模型文件不完整：模型目录 {} 缺少 {}。请先在模型下载面板下载完整模型。",
        model_dir.display(),
        missing.join(", ")
    ))
}

#[tauri::command]
pub fn check_funasr_environment(
    app: AppHandle,
    model_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let active_model_id = model_id.unwrap_or_else(|| "sensevoice-small-int8".to_string());
    let model_dir_result = crate::commands::model::find_model_dir(&app, &active_model_id);

    let missing_model_files: Vec<String> = model_dir_result
        .as_ref()
        .map(|model_dir| {
            required_model_files(&active_model_id)
                .iter()
                .copied()
                .filter(|file| !model_dir.join(file).is_file())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    let model_error = model_dir_result.as_ref().err().cloned();
    let sidecar_result = sidecar_path(&app);
    let sidecar_error = sidecar_result.as_ref().err().cloned();

    Ok(serde_json::json!({
        "modelId": active_model_id,
        "modelDir": model_dir_result
            .as_ref()
            .ok()
            .map(|model_dir| model_dir.display().to_string()),
        "modelReady": model_error.is_none() && missing_model_files.is_empty(),
        "missingModelFiles": missing_model_files,
        "modelError": model_error,
        "sidecarPath": sidecar_result
            .as_ref()
            .ok()
            .map(|path| path.display().to_string()),
        "sidecarReady": sidecar_error.is_none(),
        "sidecarError": sidecar_error,
    }))
}

/// Resolve the sidecar binary path for the current platform
fn sidecar_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?;

    let binary_name = if cfg!(target_os = "windows") {
        "funasr-asr.exe"
    } else {
        "funasr-asr"
    };

    // 1. Try resource_dir/binaries/ (production)
    let bundled = resource_dir.join("binaries").join(binary_name);
    if bundled.exists() {
        return Ok(bundled);
    }

    // 2. Try src-tauri/binaries/ (development, relative to current dir)
    let dev_path = std::path::PathBuf::from("src-tauri")
        .join("binaries")
        .join(binary_name);
    if dev_path.exists() {
        return Ok(dev_path.canonicalize().unwrap_or(dev_path));
    }

    // 3. Fall back to resource_dir path (will error with a clear message)
    Err(format!(
        "FunASR 运行程序缺失：没有找到 sidecar 可执行文件。模型文件只包含 model.int8.onnx/tokens.txt，不能直接执行识别；还需要一个本地推理程序 funasr-asr。请将可执行文件放到开发路径 {}，或打包到 {}。",
        dev_path.display(),
        bundled.display()
    ))
}

#[tauri::command]
pub async fn transcribe_with_funasr(
    app: AppHandle,
    input_path: String,
    language: Option<String>,
    model_id: Option<String>,
) -> Result<TranscriptResult, String> {
    let active_model_id = model_id.unwrap_or_else(|| "sensevoice-small-int8".to_string());
    let model_dir = crate::commands::model::find_model_dir(&app, &active_model_id)?;
    validate_model_dir(&model_dir, &active_model_id)?;
    let binary = sidecar_path(&app)?;
    let lang = language.unwrap_or_else(|| "zh".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new(&binary)
            .arg("--input")
            .arg(&input_path)
            .arg("--model")
            .arg(model_dir.to_str().unwrap_or(""))
            .arg("--language")
            .arg(&lang)
            .arg("--output-json")
            .output()
            .map_err(|e| format!("Failed to execute FunASR sidecar: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FunASR sidecar exited with error:\n{stderr}"));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        if stdout.trim().is_empty() {
            return Err("FunASR sidecar returned empty output".to_string());
        }

        let result: TranscriptResult = serde_json::from_str(&stdout).map_err(|e| {
            format!(
                "Failed to parse FunASR output as JSON: {e}\nRaw output:\n{stdout}"
            )
        })?;

        Ok(result)
    })
    .await
    .map_err(|e| format!("FunASR sidecar task failed: {e}"))?
}
