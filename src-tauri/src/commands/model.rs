use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use futures::StreamExt;
use tauri::{AppHandle, Emitter, Manager};

// --- Types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFile {
    pub path: String,
    pub url: String,
    pub size_bytes: u64,
    /// 镜像下载地址列表（主地址失败后依次尝试）
    #[serde(default)]
    pub mirrors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableModel {
    pub id: String,
    pub name: String,
    pub description: String,
    pub size_bytes: u64,
    pub files: Vec<ModelFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDownloadProgress {
    pub model_id: String,
    pub current_file: String,
    pub file_index: usize,
    pub total_files: usize,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub status: String, // "downloading" | "complete" | "error"
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllModelsStatus {
    pub all_downloaded: bool,
    pub downloaded_model_ids: Vec<String>,
    pub total_models: usize,
    pub downloaded_count: usize,
    pub total_size_bytes: u64,
    pub downloaded_size_bytes: u64,
}

// --- Available models registry ---

fn available_models() -> Vec<AvailableModel> {
    vec![
        AvailableModel {
            id: "sensevoice-small-int8".into(),
            name: "SenseVoice Small (int8)".into(),
            description: "多语种支持：中英日韩粤。基于 FunASR/SenseVoice，int8 量化，约239MB。来源：ModelScope/HuggingFace".into(),
            size_bytes: 239_549_735,
            files: vec![
                ModelFile {
                    path: "model.int8.onnx".into(),
                    // 魔搭（国内首选）→ HuggingFace → hf-mirror
                    url: "https://modelscope.cn/models/poloniumrock/SenseVoiceSmallOnnx/resolve/master/model.int8.onnx".into(),
                    size_bytes: 239_233_841,
                    mirrors: vec![
                        "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx".into(),
                        "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx".into(),
                    ],
                },
                ModelFile {
                    path: "tokens.txt".into(),
                    url: "https://modelscope.cn/models/poloniumrock/SenseVoiceSmallOnnx/resolve/master/tokens.txt".into(),
                    size_bytes: 315_894,
                    mirrors: vec![
                        "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt".into(),
                        "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt".into(),
                    ],
                },
            ],
        },
        AvailableModel {
            id: "paraformer-small-int8".into(),
            name: "Paraformer Small (int8)".into(),
            description: "中文识别优先，中文场景效果更好。基于 FunASR/Paraformer，int8 量化，约82MB。来源：HuggingFace".into(),
            size_bytes: 81_904_027,
            files: vec![
                ModelFile {
                    path: "model.int8.onnx".into(),
                    url: "https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09/resolve/main/model.int8.onnx".into(),
                    size_bytes: 81_828_675,
                    mirrors: vec![
                        "https://hf-mirror.com/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09/resolve/main/model.int8.onnx".into(),
                    ],
                },
                ModelFile {
                    path: "tokens.txt".into(),
                    url: "https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09/resolve/main/tokens.txt".into(),
                    size_bytes: 75_352,
                    mirrors: vec![
                        "https://hf-mirror.com/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09/resolve/main/tokens.txt".into(),
                    ],
                },
            ],
        },
    ]
}

// --- Path helpers ---

/// 持久化模型存储目录（app_data_dir/models），重装应用后仍然保留
fn models_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(data_dir.join("models"))
}

/// 下载时使用的目录：始终写入 app_data_dir（持久化）
fn model_download_dir(app: &AppHandle, model_id: &str) -> Result<PathBuf, String> {
    let root = models_data_dir(app)?;
    Ok(root.join(model_id))
}

/// 查找模型目录：优先 app_data_dir（用户下载），然后 resource_dir（打包），最后 dev path
pub fn find_model_dir(app: &AppHandle, model_id: &str) -> Result<PathBuf, String> {
    // 1. app_data_dir（持久化，用户下载的模型）
    let data_dir = models_data_dir(app)?;
    let data_model = data_dir.join(model_id);
    if data_model.exists() {
        return Ok(data_model);
    }

    // 2. resource_dir（打包内置的模型）
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("models").join(model_id);
        if bundled.exists() {
            return Ok(bundled);
        }
    }

    // 3. Dev fallback
    let dev_path = std::path::PathBuf::from("src-tauri")
        .join("models")
        .join(model_id);
    if dev_path.exists() {
        return Ok(dev_path.canonicalize().unwrap_or(dev_path));
    }

    // 兼容旧版硬编码路径
    if model_id == "sensevoice-small-int8" {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let legacy = resource_dir.join("models").join("sensevoice");
            if legacy.exists() {
                return Ok(legacy);
            }
        }
        let legacy_dev = std::path::PathBuf::from("src-tauri")
            .join("models")
            .join("sensevoice");
        if legacy_dev.exists() {
            return Ok(legacy_dev.canonicalize().unwrap_or(legacy_dev));
        }
    }

    // 返回 data_dir 路径（用于后续可能的下载）
    Ok(data_model)
}

// --- Commands ---

#[tauri::command]
pub fn list_available_models() -> Vec<AvailableModel> {
    available_models()
}

#[tauri::command]
pub fn check_model_downloaded(app: AppHandle, model_id: String) -> Result<Option<String>, String> {
    let model = available_models()
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("Unknown model: {model_id}"))?;

    let dir = find_model_dir(&app, &model_id)?;

    // 检查所有文件存在且大小正确
    for file in &model.files {
        let file_path = dir.join(&file.path);
        if !file_path.exists() {
            return Ok(None);
        }
        match std::fs::metadata(&file_path) {
            Ok(metadata) if metadata.len() == file.size_bytes => {},
            _ => return Ok(None),
        }
    }

    Ok(Some(dir.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn check_all_models_downloaded(app: AppHandle) -> Result<AllModelsStatus, String> {
    let models = available_models();
    let mut downloaded_model_ids = Vec::new();
    let mut downloaded_size_bytes: u64 = 0;
    let mut total_size_bytes: u64 = 0;

    for model in &models {
        total_size_bytes += model.size_bytes;

        let dir = find_model_dir(&app, &model.id)?;
        let mut all_files_ok = true;

        for file in &model.files {
            let file_path = dir.join(&file.path);
            if !file_path.exists() {
                all_files_ok = false;
                break;
            }
            match std::fs::metadata(&file_path) {
                Ok(metadata) if metadata.len() == file.size_bytes => {},
                _ => {
                    all_files_ok = false;
                    break;
                }
            }
        }

        if all_files_ok {
            downloaded_model_ids.push(model.id.clone());
            downloaded_size_bytes += model.size_bytes;
        }
    }

    let downloaded_count = downloaded_model_ids.len();
    let total_models = models.len();

    Ok(AllModelsStatus {
        all_downloaded: downloaded_count == total_models,
        downloaded_model_ids,
        total_models,
        downloaded_count,
        total_size_bytes,
        downloaded_size_bytes,
    })
}

/// 下载单个模型的所有文件到 app_data_dir
#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    model_id: String,
) -> Result<Option<String>, String> {
    let model = available_models()
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("Unknown model: {model_id}"))?;

    let dir = model_download_dir(&app, &model_id)?;
    let total_bytes: u64 = model.files.iter().map(|f| f.size_bytes).sum();
    let total_files = model.files.len();

    let downloaded = download_model_files(
        &app,
        &model,
        &dir,
        0,
        total_bytes,
        total_files,
        &model_id,
        0, // global file offset (0 for single model)
    )
    .await?;

    let _ = downloaded; // bytes downloaded this call

    // Emit complete
    let _ = app.emit("model-download-progress", ModelDownloadProgress {
        model_id: model_id.clone(),
        current_file: "done".into(),
        file_index: model.files.len(),
        total_files: model.files.len(),
        downloaded_bytes: total_bytes,
        total_bytes,
        status: "complete".into(),
        error: None,
    });

    Ok(Some(dir.to_string_lossy().to_string()))
}

/// 一次性下载所有 FunASR 模型
#[tauri::command]
pub async fn download_all_models(app: AppHandle) -> Result<AllModelsStatus, String> {
    let models = available_models();

    // 全局统计
    let grand_total_bytes: u64 = models.iter().map(|m| m.size_bytes).sum();
    let grand_total_files: usize = models.iter().map(|m| m.files.len()).sum();

    let emit_error = |app: &AppHandle, msg: &str| {
        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: "all".into(),
            current_file: String::new(),
            file_index: 0,
            total_files: grand_total_files,
            downloaded_bytes: 0,
            total_bytes: grand_total_bytes,
            status: "error".into(),
            error: Some(msg.to_string()),
        });
    };

    let mut cumulative_downloaded: u64 = 0;
    let mut global_file_index: usize = 0;
    let mut downloaded_model_ids: Vec<String> = Vec::new();

    for model in &models {
        let dir = model_download_dir(&app, &model.id)?;

        std::fs::create_dir_all(&dir).map_err(|e| {
            let msg = format!("无法创建模型目录 {}: {e}", dir.display());
            emit_error(&app, &msg);
            msg
        })?;

        // 下载该模型文件，进度累加到全局
        let _new_bytes = download_model_files(
            &app,
            model,
            &dir,
            cumulative_downloaded,
            grand_total_bytes,
            grand_total_files,
            "all",
            global_file_index,
        )
        .await?;

        cumulative_downloaded += model.size_bytes;
        global_file_index += model.files.len();
        downloaded_model_ids.push(model.id.clone());
    }

    // Emit overall complete
    let _ = app.emit("model-download-progress", ModelDownloadProgress {
        model_id: "all".into(),
        current_file: "done".into(),
        file_index: grand_total_files,
        total_files: grand_total_files,
        downloaded_bytes: grand_total_bytes,
        total_bytes: grand_total_bytes,
        status: "complete".into(),
        error: None,
    });

    Ok(AllModelsStatus {
        all_downloaded: true,
        downloaded_model_ids,
        total_models: models.len(),
        downloaded_count: models.len(),
        total_size_bytes: grand_total_bytes,
        downloaded_size_bytes: grand_total_bytes,
    })
}

/// 下载一个模型的所有文件（核心逻辑，供 download_model / download_all_models 共用）
///
/// - `offset_bytes`: 该批次之前已下载的字节数（用于全局进度条）
/// - `grand_total_bytes`: 全局总字节数（单模型下载时 = 该模型大小）
/// - `grand_total_files`: 全局总文件数（单模型下载时 = 该模型文件数）
/// - `model_id_for_event`: 进度事件中的 model_id（单模型用 model_id，全部用 "all"）
/// - `global_file_offset`: 全局文件序号偏移（单模型下载时 = 0）
/// - 返回本次新下载的字节数（不含已跳过的）
async fn download_model_files(
    app: &AppHandle,
    model: &AvailableModel,
    dir: &std::path::Path,
    offset_bytes: u64,
    grand_total_bytes: u64,
    grand_total_files: usize,
    model_id_for_event: &str,
    global_file_offset: usize,
) -> Result<u64, String> {
    let emit_error = |app: &AppHandle, msg: &str| {
        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: model_id_for_event.into(),
            current_file: String::new(),
            file_index: 0,
            total_files: grand_total_files,
            downloaded_bytes: offset_bytes,
            total_bytes: grand_total_bytes,
            status: "error".into(),
            error: Some(msg.to_string()),
        });
    };

    std::fs::create_dir_all(dir).map_err(|e| {
        let msg = format!("无法创建模型目录: {e}");
        emit_error(app, &msg);
        msg
    })?;

    // 先检查哪些文件已存在且大小正确
    let mut cumulative_downloaded: u64 = offset_bytes;
    let mut files_to_download: Vec<(usize, &ModelFile)> = Vec::new();

    for (i, file) in model.files.iter().enumerate() {
        let file_path = dir.join(&file.path);
        let already_exists = file_path.exists()
            && std::fs::metadata(&file_path)
                .map(|m| m.len() == file.size_bytes)
                .unwrap_or(false);

        if already_exists {
            eprintln!(
                "[model] 跳过已存在: {} ({} bytes)",
                file.path, file.size_bytes
            );
            cumulative_downloaded += file.size_bytes;

            let global_idx = global_file_offset + i + 1;
            let _ = app.emit("model-download-progress", ModelDownloadProgress {
                model_id: model_id_for_event.into(),
                current_file: format!("跳过: {}", file.path),
                file_index: global_idx,
                total_files: grand_total_files,
                downloaded_bytes: cumulative_downloaded,
                total_bytes: grand_total_bytes,
                status: "skipped".into(),
                error: None,
            });
        } else {
            // 如果文件存在但大小不匹配，删除旧文件
            if file_path.exists() {
                eprintln!(
                    "[model] 删除不完整文件: {} (expected {} bytes)",
                    file.path, file.size_bytes
                );
                std::fs::remove_file(&file_path).ok();
            }
            files_to_download.push((i, file));
        }
    }

    // 如果所有文件都已存在，直接返回
    if files_to_download.is_empty() {
        return Ok(0);
    }

    // Emit initial progress
    if let Some((_, first_file)) = files_to_download.first() {
        let global_idx = global_file_offset + files_to_download.first().map(|(i, _)| *i).unwrap_or(0) + 1;
        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: model_id_for_event.into(),
            current_file: first_file.path.clone(),
            file_index: global_idx,
            total_files: grand_total_files,
            downloaded_bytes: cumulative_downloaded,
            total_bytes: grand_total_bytes,
            status: "downloading".into(),
            error: None,
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(30))
        .user_agent("FlyCut-Caption/1.0")
        .build()
        .map_err(|e| {
            let msg = format!("无法创建 HTTP 客户端: {e}");
            emit_error(app, &msg);
            msg
        })?;

    let mut new_bytes_downloaded: u64 = 0;

    for &(i, file) in &files_to_download {
        let file_path = dir.join(&file.path);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                let msg = format!("无法创建目录 {}: {e}", parent.display());
                emit_error(app, &msg);
                msg
            })?;
        }

        let file_id = file.path.clone();
        let app_clone = app.clone();
        let model_id_clone = model_id_for_event.to_string();
        let global_idx = global_file_offset + i + 1;

        // Emit per-file start
        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: model_id_for_event.into(),
            current_file: file.path.clone(),
            file_index: global_idx,
            total_files: grand_total_files,
            downloaded_bytes: cumulative_downloaded,
            total_bytes: grand_total_bytes,
            status: "downloading".into(),
            error: None,
        });

        // ===== 带断点续传的多镜像重试下载 =====
        // 构建下载地址列表：主地址 + 镜像地址
        // 每个地址最多尝试一次，全部失败后才报错
        let all_urls: Vec<String> = std::iter::once(file.url.clone())
            .chain(file.mirrors.iter().cloned())
            .collect();
        let max_attempts = all_urls.len() as u32;

        let mut file_downloaded: u64 = 0;
        let mut last_error: Option<String> = None;
        let mut download_ok = false;

        'retry: for (attempt, url) in all_urls.iter().enumerate() {
            let attempt = attempt as u32 + 1;
            eprintln!(
                "[model] 下载 {} (尝试 {}/{}): {}",
                file.path, attempt, max_attempts, url
            );

            // 检查已有部分文件，支持断点续传
            let resume_from = if file_path.exists() {
                std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0)
            } else {
                0
            };

            // 续传用 append 模式，否则新建
            let mut dest = if resume_from > 0 {
                eprintln!(
                    "[model] 续传 {} 从 {} 字节开始 (尝试 {}/{})",
                    file.path, resume_from, attempt, max_attempts
                );
                std::fs::OpenOptions::new().append(true).open(&file_path)
            } else {
                std::fs::File::create(&file_path)
            }
            .map_err(|e| {
                let msg = format!("无法写入文件 {}: {e}", file_path.display());
                emit_error(app, &msg);
                msg
            })?;

            file_downloaded = resume_from;

            // 带 Range 头的请求
            let mut request = client.get(url.as_str());
            if resume_from > 0 {
                request = request.header("Range", format!("bytes={}-", resume_from));
            }

            let response = match request.send().await {
                Ok(resp) => resp,
                Err(e) => {
                    last_error = Some(format!("连接失败: {e}"));
                    eprintln!("[model] 连接失败 (尝试 {}/{}): {e}", attempt, max_attempts);
                    if attempt < max_attempts {
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                        continue 'retry;
                    }
                    break 'retry;
                }
            };

            let status = response.status();
            // 206 = Partial Content（支持续传），200 = 完整内容
            if !status.is_success() {
                last_error = Some(format!("HTTP {}", status));
                eprintln!("[model] HTTP 错误 (尝试 {}/{}): {}", attempt, max_attempts, status);
                if attempt < max_attempts {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue 'retry;
                }
                break 'retry;
            }

            // 服务器返回 200（忽略 Range），需要从头开始
            let is_resumed = status.as_u16() == 206;
            if !is_resumed && resume_from > 0 {
                eprintln!("[model] 服务器不支持续传，重新下载");
                file_downloaded = 0;
                dest = std::fs::File::create(&file_path).map_err(|e| {
                    let msg = format!("无法写入文件 {}: {e}", file_path.display());
                    emit_error(app, &msg);
                    msg
                })?;
            }

            let mut stream = response.bytes_stream();
            let mut stream_error = false;
            let mut last_emit = std::time::Instant::now();

            while let Some(chunk_result) = stream.next().await {
                let chunk = match chunk_result {
                    Ok(c) => c,
                    Err(e) => {
                        last_error = Some(format!("下载数据出错: {e}"));
                        eprintln!(
                            "[model] 数据流中断 (尝试 {}/{}): {e}",
                            attempt, max_attempts
                        );
                        stream_error = true;
                        break;
                    }
                };

                if let Err(e) = dest.write_all(&chunk) {
                    let msg = format!("写入文件出错 {}: {e}", file_path.display());
                    emit_error(app, &msg);
                    std::fs::remove_file(&file_path).ok();
                    return Err(msg);
                }

                file_downloaded += chunk.len() as u64;

                // 每 200ms 发一次进度事件，避免 UI 事件洪泛，同时不拖慢下载
                if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
                    let current_total = cumulative_downloaded + file_downloaded;
                    let _ = app_clone.emit("model-download-progress", ModelDownloadProgress {
                        model_id: model_id_clone.clone(),
                        current_file: file_id.clone(),
                        file_index: global_idx,
                        total_files: grand_total_files,
                        downloaded_bytes: current_total,
                        total_bytes: grand_total_bytes,
                        status: "downloading".into(),
                        error: None,
                    });
                    last_emit = std::time::Instant::now();
                }
            }

            if stream_error {
                if attempt < max_attempts {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue 'retry;
                }
                break 'retry;
            }

            // 流完整结束
            download_ok = true;
            break 'retry;
        }

        // 所有镜像均失败
        if !download_ok {
            let err = last_error.unwrap_or_else(|| "未知错误".into());
            let msg = format!(
                "下载失败：{}（已尝试 {} 个镜像源）\n主地址：{}\n可能原因：网络不稳定，请检查网络后重试。",
                err, max_attempts, file.url
            );
            emit_error(app, &msg);
            std::fs::remove_file(&file_path).ok();
            return Err(msg);
        }

        // 最终验证文件大小（用已知的目标大小，比 content-length 更可靠）
        let actual_size = std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);
        if actual_size != file.size_bytes {
            let msg = format!(
                "文件 {} 大小不匹配：期望 {} 字节，实际 {} 字节",
                file.path, file.size_bytes, actual_size
            );
            emit_error(app, &msg);
            std::fs::remove_file(&file_path).ok();
            return Err(msg);
        }

        cumulative_downloaded += file_downloaded;
        new_bytes_downloaded += file_downloaded;
    }

    Ok(new_bytes_downloaded)
}
