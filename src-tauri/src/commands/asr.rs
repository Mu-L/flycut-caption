use crate::commands::model_manifest::{self, ManifestModel};
use crate::models::transcript::TranscriptResult;
use std::process::Command;
use tauri::AppHandle;
use tauri::Manager;

/// 默认 model_id（与 manifest 中 recommended=true 的中文多语种模型对齐）
const DEFAULT_MODEL_ID: &str = "sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17";

/// 校验模型目录下 manifest 声明的所有文件都存在。
fn validate_model_dir(model_dir: &std::path::Path, model: &ManifestModel) -> Result<(), String> {
    let missing: Vec<String> = model
        .files
        .iter()
        .filter(|f| !model_dir.join(&f.path).is_file())
        .map(|f| f.path.clone())
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
    let active_model_id = model_id.unwrap_or_else(|| DEFAULT_MODEL_ID.to_string());

    // 从 manifest 查找模型定义
    let manifest = model_manifest::load_manifest(&app)?;
    let model = model_manifest::find_model(manifest, &active_model_id);

    let model_dir_result = crate::commands::model::find_model_dir(&app, &active_model_id);

    // 遍历 manifest.files 检查缺失文件
    let missing_model_files: Vec<String> = match (&model, &model_dir_result) {
        (Some(m), Ok(dir)) => m
            .files
            .iter()
            .filter(|f| !dir.join(&f.path).is_file())
            .map(|f| f.path.clone())
            .collect(),
        _ => Vec::new(),
    };

    let model_error = if model.is_none() {
        Some(format!("模型 {} 不在 manifest 中", active_model_id))
    } else if model_dir_result.is_err() {
        model_dir_result.as_ref().err().cloned()
    } else {
        None
    };

    let sidecar_result = sidecar_path(&app);
    let sidecar_error = sidecar_result.as_ref().err().cloned();

    Ok(serde_json::json!({
        "modelId": active_model_id,
        "modelDir": model_dir_result
            .as_ref()
            .ok()
            .map(|model_dir| model_dir.display().to_string()),
        "modelReady": model.is_some() && model_error.is_none() && missing_model_files.is_empty(),
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
        "FunASR 运行程序缺失：没有找到 sidecar 可执行文件。模型文件只包含模型资源，不能直接执行识别；还需要一个本地推理程序 funasr-asr。请将可执行文件放到开发路径 {}，或打包到 {}。",
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
    let active_model_id = model_id.unwrap_or_else(|| DEFAULT_MODEL_ID.to_string());

    // 从 manifest 读取模型定义（family + recognizer_config）
    let manifest = model_manifest::load_manifest(&app)?;
    let model = model_manifest::find_model(manifest, &active_model_id)
        .ok_or_else(|| format!("模型 {} 不在 manifest 中", active_model_id))?;
    if !model.enabled {
        return Err(format!("模型 {} 已被禁用", active_model_id));
    }

    let model_dir = crate::commands::model::find_model_dir(&app, &active_model_id)?;
    validate_model_dir(&model_dir, model)?;
    let binary = sidecar_path(&app)?;
    let ffmpeg_path = crate::ffmpeg_bin::resolve_ffmpeg(Some(&app))?.path;

    // 默认使用 FunASR FSMN VAD；silero 作 fallback
    let vad_dir = crate::commands::model::find_shared_asset_dir(&app, "funasr-fsmn-vad")?;

    // 序列化 recognizer_config 为 JSON 字符串传给 sidecar
    let recognizer_config_json = serde_json::to_string(&model.recognizer_config)
        .map_err(|e| format!("序列化 recognizer_config 失败: {e}"))?;

    let lang = language.unwrap_or_else(|| "zh".to_string());
    let family = model.family.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new(&binary)
            .env("FFMPEG_PATH", &ffmpeg_path)
            .arg("--input")
            .arg(&input_path)
            .arg("--model")
            .arg(model_dir.to_str().unwrap_or(""))
            .arg("--model-type")
            .arg(&family)
            .arg("--recognizer-config")
            .arg(&recognizer_config_json)
            .arg("--vad-type")
            .arg("fsmn")
            .arg("--vad-dir")
            .arg(vad_dir.to_str().unwrap_or(""))
            .arg("--language")
            .arg(&lang)
            .arg("--timestamp-mode")
            .arg("auto")
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
