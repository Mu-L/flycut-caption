// FunASR / sherpa-onnx 模型管理
// 模型清单从 models.json (manifest) 读取，下载到 app_data_dir 持久化
//
// 数据流：
//   models.json (resource) → model_manifest::load_manifest → AvailableModel → 前端
//   前端 download_model(model_id) → 下载 .tar.bz2 + 解压 → app_data_dir/models/<id>/

use crate::commands::model_manifest::{
    self, enabled_models, find_model, find_shared_asset, sorted_download_sources, ManifestModel,
    ModelTimestamp,
};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

// --- 对外暴露的类型（与前端 types/model.ts 对齐）---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableModel {
    pub id: String,
    pub name: String,
    pub family: String,
    pub enabled: bool,
    pub recommended: bool,
    pub languages: Vec<String>,
    pub description: String,
    pub mode: String,
    #[serde(default)]
    pub quantization: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    pub supports_subtitle: bool,
    pub timestamp: ModelTimestampDto,
    pub artifact: ArtifactDto,
    pub files: Vec<ManifestFileDto>,
    /// 保留为 serde_json::Value，sidecar 端按 model_type 反序列化
    pub recognizer_config: serde_json::Value,
    pub download_sources: Vec<DownloadSourceDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelTimestampDto {
    pub level: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub required_vad: Option<bool>,
    #[serde(default)]
    pub token_timestamp_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactDto {
    pub archive_name: String,
    pub extract_dir: String,
    #[serde(default)]
    pub size_mb_estimate: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestFileDto {
    pub path: String,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadSourceDto {
    pub region: String,
    pub provider: String,
    pub url: String,
    #[serde(default)]
    pub verify_before_use: Option<bool>,
    #[serde(default)]
    pub download_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedAssetDto {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub description: String,
    pub required_for_subtitle: bool,
    pub files: Vec<ManifestFileDto>,
    pub download_sources: Vec<DownloadSourceDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDownloadProgress {
    pub model_id: String,
    pub current_file: String,
    pub file_index: usize,
    pub total_files: usize,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub status: String, // "downloading" | "skipped" | "complete" | "error"
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedAssetStatus {
    pub available: bool,
    pub path: Option<String>,
    /// true：来自安装包 resource_dir；false：用户下载到 app_data_dir
    pub bundled: bool,
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

// --- 路径辅助 ---

/// 持久化模型存储目录（app_data_dir/models），重装应用后仍然保留
fn models_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(data_dir.join("models"))
}

/// 共享资源目录（app_data_dir/shared_assets/<id>），用于存放 silero-vad 等
fn shared_assets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(data_dir.join("shared_assets"))
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
    let dev_path = PathBuf::from("src-tauri")
        .join("models")
        .join(model_id);
    if dev_path.exists() {
        return Ok(dev_path.canonicalize().unwrap_or(dev_path));
    }

    // 返回 data_dir 路径（用于后续可能的下载）
    Ok(data_model)
}

/// 解析共享资源：用户下载目录优先，其次安装包内置 resource_dir
fn resolve_shared_asset(app: &AppHandle, asset_id: &str) -> Result<SharedAssetStatus, String> {
    let manifest = model_manifest::load_manifest(app)?;
    let asset = find_shared_asset(manifest, asset_id)
        .ok_or_else(|| format!("共享资源 {asset_id} 不在 manifest 中"))?;

    // app_data_dir 在部分环境可能暂不可用，不应阻断内置资源检测
    if let Ok(assets_root) = shared_assets_dir(app) {
        let user_dir = assets_root.join(asset_id);
        if shared_asset_files_complete(&user_dir, &asset.files) {
            return Ok(SharedAssetStatus {
                available: true,
                path: Some(user_dir.to_string_lossy().to_string()),
                bundled: false,
            });
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_dir = resource_dir.join("shared_assets").join(asset_id);
        if shared_asset_files_complete(&bundled_dir, &asset.files) {
            return Ok(SharedAssetStatus {
                available: true,
                path: Some(bundled_dir.to_string_lossy().to_string()),
                bundled: true,
            });
        }
    }

    // Dev：resource_dir 未映射时，直接读 src-tauri/shared_assets（fetch:shared-assets 输出目录）
    #[cfg(debug_assertions)]
    {
        let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("shared_assets")
            .join(asset_id);
        if shared_asset_files_complete(&dev_dir, &asset.files) {
            return Ok(SharedAssetStatus {
                available: true,
                path: Some(dev_dir.to_string_lossy().to_string()),
                bundled: true,
            });
        }
    }

    Ok(SharedAssetStatus {
        available: false,
        path: None,
        bundled: false,
    })
}

fn shared_asset_files_complete(
    dir: &std::path::Path,
    files: &[model_manifest::ManifestFile],
) -> bool {
    files
        .iter()
        .all(|f| dir.join(&f.path).is_file())
}

/// 查找共享资源目录（如 funasr-fsmn-vad/）
pub fn find_shared_asset_dir(app: &AppHandle, asset_id: &str) -> Result<PathBuf, String> {
    let status = resolve_shared_asset(app, asset_id)?;
    if !status.available {
        return Err(format!(
            "共享资源 {asset_id} 不可用。请重新安装应用或在模型下载面板下载。"
        ));
    }
    Ok(PathBuf::from(status.path.unwrap_or_default()))
}

/// 查找共享资源文件路径（如 silero-vad/silero_vad.onnx）
pub fn find_shared_asset_path(app: &AppHandle, asset_id: &str) -> Result<PathBuf, String> {
    let manifest = model_manifest::load_manifest(app)?;
    let asset = find_shared_asset(manifest, asset_id)
        .ok_or_else(|| format!("共享资源 {asset_id} 不在 manifest 中"))?;

    let status = resolve_shared_asset(app, asset_id)?;
    if !status.available {
        return Err(format!(
            "共享资源 {asset_id} 不可用。请重新安装应用或在模型下载面板下载 silero-vad。"
        ));
    }

    let base = PathBuf::from(status.path.unwrap_or_default());
    for file in &asset.files {
        let path = base.join(&file.path);
        if path.is_file() {
            return Ok(path);
        }
    }

    Err(format!("共享资源 {asset_id} 缺少文件"))
}

// --- 模型清单查询 ---

#[tauri::command]
pub fn list_available_models(app: AppHandle) -> Result<Vec<AvailableModel>, String> {
    let manifest = model_manifest::load_manifest(&app)?;
    Ok(enabled_models(manifest)
        .iter()
        .map(|m| manifest_model_to_dto(m))
        .collect())
}

#[tauri::command]
pub fn list_shared_assets(app: AppHandle) -> Result<Vec<SharedAssetDto>, String> {
    let manifest = model_manifest::load_manifest(&app)?;
    Ok(manifest
        .shared_assets
        .iter()
        .map(|a| SharedAssetDto {
            id: a.id.clone(),
            name: a.name.clone(),
            r#type: a.r#type.clone(),
            description: a.description.clone(),
            required_for_subtitle: a.required_for_subtitle,
            files: a.files.iter().map(|f| ManifestFileDto {
                path: f.path.clone(),
                sha256: f.sha256.clone(),
            }).collect(),
            download_sources: a.download_sources.iter().map(|s| DownloadSourceDto {
                region: s.region.clone(),
                provider: s.provider.clone(),
                url: s.url.clone(),
                verify_before_use: s.verify_before_use,
                download_mode: s.download_mode.clone(),
            }).collect(),
        })
        .collect())
}

fn model_timestamp_to_dto(timestamp: &ModelTimestamp) -> ModelTimestampDto {
    ModelTimestampDto {
        level: timestamp.level.clone(),
        source: timestamp.source.clone(),
        required_vad: timestamp.required_vad,
        token_timestamp_verified: timestamp.token_timestamp_verified,
    }
}

fn manifest_model_to_dto(m: &ManifestModel) -> AvailableModel {
    AvailableModel {
        id: m.id.clone(),
        name: m.name.clone(),
        family: m.family.clone(),
        enabled: m.enabled,
        recommended: m.recommended,
        languages: m.languages.clone(),
        description: m.description.clone(),
        mode: m.mode.clone(),
        quantization: m.quantization.clone(),
        size: m.size.clone(),
        supports_subtitle: m.supports_subtitle,
        timestamp: model_timestamp_to_dto(&m.timestamp),
        artifact: ArtifactDto {
            archive_name: m.artifact.archive_name.clone(),
            extract_dir: m.artifact.extract_dir.clone(),
            size_mb_estimate: m.artifact.size_mb_estimate,
        },
        files: m.files.iter().map(|f| ManifestFileDto {
            path: f.path.clone(),
            sha256: f.sha256.clone(),
        }).collect(),
        recognizer_config: m.recognizer_config.clone(),
        download_sources: m.download_sources.iter().map(|s| DownloadSourceDto {
            region: s.region.clone(),
            provider: s.provider.clone(),
            url: s.url.clone(),
            verify_before_use: s.verify_before_use,
            download_mode: s.download_mode.clone(),
        }).collect(),
    }
}

// --- 模型下载状态检查 ---

#[tauri::command]
pub fn check_model_downloaded(app: AppHandle, model_id: String) -> Result<Option<String>, String> {
    let manifest = model_manifest::load_manifest(&app)?;
    let model = find_model(manifest, &model_id)
        .ok_or_else(|| format!("Unknown model: {model_id}"))?;

    let dir = find_model_dir(&app, &model_id)?;

    // 校验 manifest.files 中所有文件存在（不强校验大小，sha256 在 manifest 中全为 null）
    for file in &model.files {
        let file_path = dir.join(&file.path);
        if !file_path.exists() {
            return Ok(None);
        }
    }

    Ok(Some(dir.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn check_all_models_downloaded(app: AppHandle) -> Result<AllModelsStatus, String> {
    let manifest = model_manifest::load_manifest(&app)?;
    let models: Vec<&ManifestModel> = enabled_models(manifest);

    let mut downloaded_model_ids = Vec::new();
    let mut downloaded_size_bytes: u64 = 0;
    let mut total_size_bytes: u64 = 0;

    for model in &models {
        // size_mb_estimate 在 manifest 中部分为 null，用 0 兜底
        let size_bytes = model
            .artifact
            .size_mb_estimate
            .map(|mb| (mb * 1_000_000.0) as u64)
            .unwrap_or(0);
        total_size_bytes += size_bytes;

        let dir = find_model_dir(&app, &model.id)?;
        let mut all_files_ok = true;

        for file in &model.files {
            let file_path = dir.join(&file.path);
            if !file_path.exists() {
                all_files_ok = false;
                break;
            }
        }

        if all_files_ok {
            downloaded_model_ids.push(model.id.clone());
            downloaded_size_bytes += size_bytes;
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

#[tauri::command]
pub fn check_shared_asset_downloaded(
    app: AppHandle,
    asset_id: String,
) -> Result<SharedAssetStatus, String> {
    resolve_shared_asset(&app, &asset_id)
}

// --- 下载逻辑 ---

/// 下载单个模型（归档 .tar.bz2 下载 + 解压）
#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    model_id: String,
) -> Result<Option<String>, String> {
    let manifest = model_manifest::load_manifest(&app)?;
    let model = find_model(manifest, &model_id)
        .ok_or_else(|| format!("Unknown model: {model_id}"))?;

    let dir = model_download_dir(&app, &model_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建模型目录 {}: {e}", dir.display()))?;

    // 检查是否所有文件都已存在
    let all_present = model.files.iter().all(|f| dir.join(&f.path).is_file());
    if all_present {
        // Emit skipped + complete
        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: model_id.clone(),
            current_file: "已存在".into(),
            file_index: model.files.len(),
            total_files: model.files.len(),
            downloaded_bytes: 0,
            total_bytes: 0,
            status: "skipped".into(),
            error: None,
        });
        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: model_id.clone(),
            current_file: "done".into(),
            file_index: model.files.len(),
            total_files: model.files.len(),
            downloaded_bytes: 0,
            total_bytes: 0,
            status: "complete".into(),
            error: None,
        });
        return Ok(Some(dir.to_string_lossy().to_string()));
    }

    let sources = sorted_download_sources(&model.download_sources);
    let file_sources: Vec<_> = sources
        .iter()
        .filter(|s| model_manifest::is_file_mode_source(s))
        .copied()
        .collect();
    let archive_sources: Vec<_> = sources
        .iter()
        .filter(|s| s.url.ends_with(".tar.bz2"))
        .copied()
        .collect();

    // 1. 优先尝试 HF / ModelScope 按文件下载（国内镜像，无 .tar.bz2）
    for source in &file_sources {
        eprintln!(
            "[model] 按文件下载 ({}): {}",
            source.provider, source.url
        );
        match download_model_files_from_base(
            &app,
            source,
            &model.files,
            &dir,
            &model_id,
        )
        .await
        {
            Ok(()) => {
                let _ = app.emit("model-download-progress", ModelDownloadProgress {
                    model_id: model_id.clone(),
                    current_file: "done".into(),
                    file_index: model.files.len(),
                    total_files: model.files.len(),
                    downloaded_bytes: 0,
                    total_bytes: 0,
                    status: "complete".into(),
                    error: None,
                });
                return Ok(Some(dir.to_string_lossy().to_string()));
            }
            Err(e) => {
                eprintln!("[model] 按文件下载失败 ({}): {e}", source.provider);
            }
        }
    }

    // 2. 回退：GitHub Releases 归档下载 + 解压
    if archive_sources.is_empty() {
        return Err(
            "没有可用的下载源：镜像按文件下载失败，且未配置 .tar.bz2 归档地址".into(),
        );
    }

    let archive_size_estimate = model
        .artifact
        .size_mb_estimate
        .map(|mb| (mb * 1_000_000.0) as u64)
        .unwrap_or(0);

    let archive_path = dir.with_extension("tar.bz2.tmp");

    let _ = app.emit("model-download-progress", ModelDownloadProgress {
        model_id: model_id.clone(),
        current_file: model.artifact.archive_name.clone(),
        file_index: 0,
        total_files: 1,
        downloaded_bytes: 0,
        total_bytes: archive_size_estimate,
        status: "downloading".into(),
        error: None,
    });

    download_archive_with_retries(
        &app,
        &archive_sources,
        &archive_path,
        &model_id,
        archive_size_estimate,
    )
    .await?;

    let _ = app.emit("model-download-progress", ModelDownloadProgress {
        model_id: model_id.clone(),
        current_file: "正在解压归档...".into(),
        file_index: 0,
        total_files: 1,
        downloaded_bytes: archive_size_estimate,
        total_bytes: archive_size_estimate,
        status: "downloading".into(),
        error: None,
    });

    extract_tar_bz2(&archive_path, &dir, &model.artifact.extract_dir)
        .await
        .map_err(|e| {
            let _ = std::fs::remove_file(&archive_path);
            let msg = format!("解压失败：{e}");
            let _ = app.emit("model-download-progress", ModelDownloadProgress {
                model_id: model_id.clone(),
                current_file: String::new(),
                file_index: 0,
                total_files: 1,
                downloaded_bytes: 0,
                total_bytes: archive_size_estimate,
                status: "error".into(),
                error: Some(msg.clone()),
            });
            msg
        })?;

    let _ = std::fs::remove_file(&archive_path);

    for file in &model.files {
        let file_path = dir.join(&file.path);
        if !file_path.exists() {
            let msg = format!(
                "解压后缺少文件：{}（期望在 {}）",
                file.path,
                file_path.display()
            );
            let _ = app.emit("model-download-progress", ModelDownloadProgress {
                model_id: model_id.clone(),
                current_file: String::new(),
                file_index: 0,
                total_files: 1,
                downloaded_bytes: 0,
                total_bytes: archive_size_estimate,
                status: "error".into(),
                error: Some(msg.clone()),
            });
            return Err(msg);
        }
    }

    let _ = app.emit("model-download-progress", ModelDownloadProgress {
        model_id: model_id.clone(),
        current_file: "done".into(),
        file_index: 1,
        total_files: 1,
        downloaded_bytes: archive_size_estimate,
        total_bytes: archive_size_estimate,
        status: "complete".into(),
        error: None,
    });

    Ok(Some(dir.to_string_lossy().to_string()))
}

/// 下载共享资源（如 silero-vad，单文件下载，无解压）
#[tauri::command]
pub async fn download_shared_asset(
    app: AppHandle,
    asset_id: String,
) -> Result<Option<String>, String> {
    let manifest = model_manifest::load_manifest(&app)?;
    let asset = find_shared_asset(manifest, &asset_id)
        .ok_or_else(|| format!("Unknown shared asset: {asset_id}"))?;

    // 安装包已内置时无需再下载到 app_data_dir
    if let Ok(status) = resolve_shared_asset(&app, &asset_id) {
        if status.available && status.bundled {
            let _ = app.emit("model-download-progress", ModelDownloadProgress {
                model_id: asset_id.clone(),
                current_file: "已内置".into(),
                file_index: asset.files.len(),
                total_files: asset.files.len(),
                downloaded_bytes: 0,
                total_bytes: 0,
                status: "skipped".into(),
                error: None,
            });
            let _ = app.emit("model-download-progress", ModelDownloadProgress {
                model_id: asset_id.clone(),
                current_file: "done".into(),
                file_index: asset.files.len(),
                total_files: asset.files.len(),
                downloaded_bytes: 0,
                total_bytes: 0,
                status: "complete".into(),
                error: None,
            });
            return Ok(status.path);
        }
    }

    let assets_root = shared_assets_dir(&app)?;
    let asset_dir = assets_root.join(&asset_id);
    std::fs::create_dir_all(&asset_dir)
        .map_err(|e| format!("无法创建目录 {}: {e}", asset_dir.display()))?;

    // 检查是否所有文件都已存在（用户目录）
    let all_present = shared_asset_files_complete(&asset_dir, &asset.files);
    if all_present {
        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: asset_id.clone(),
            current_file: "已存在".into(),
            file_index: asset.files.len(),
            total_files: asset.files.len(),
            downloaded_bytes: 0,
            total_bytes: 0,
            status: "skipped".into(),
            error: None,
        });
        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: asset_id.clone(),
            current_file: "done".into(),
            file_index: asset.files.len(),
            total_files: asset.files.len(),
            downloaded_bytes: 0,
            total_bytes: 0,
            status: "complete".into(),
            error: None,
        });
        return Ok(Some(asset_dir.to_string_lossy().to_string()));
    }

    // 逐文件下载
    let sources = sorted_download_sources(&asset.download_sources);
    let total_bytes: u64 = 0; // shared asset 大小未知，用 0 兜底，UI 显示百分比时 fallback

    for (idx, file) in asset.files.iter().enumerate() {
        let file_path = asset_dir.join(&file.path);

        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: asset_id.clone(),
            current_file: file.path.clone(),
            file_index: idx,
            total_files: asset.files.len(),
            downloaded_bytes: 0,
            total_bytes,
            status: "downloading".into(),
            error: None,
        });

        let file_sources: Vec<&model_manifest::DownloadSource> = sources
            .iter()
            .copied()
            .filter(|source| {
                source.url.ends_with(&file.path)
                    || source.url.contains(&format!("/{}/", file.path))
            })
            .collect();
        let effective_sources = if file_sources.is_empty() {
            sources.clone()
        } else {
            file_sources
        };

        download_single_file_with_retries(
            &app,
            &effective_sources,
            &file_path,
            &asset_id,
            idx + 1,
            asset.files.len(),
            total_bytes,
        )
        .await?;
    }

    // funasr-fsmn-vad：兼容 funasr_onnx 的 config.yaml / am.mvn 命名
    if asset_id == "funasr-fsmn-vad" {
        let config_yaml = asset_dir.join("config.yaml");
        let vad_yaml = asset_dir.join("vad.yaml");
        if !config_yaml.is_file() && vad_yaml.is_file() {
            std::fs::copy(&vad_yaml, &config_yaml)
                .map_err(|e| format!("创建 config.yaml 失败: {e}"))?;
        }
        let am_mvn = asset_dir.join("am.mvn");
        let vad_mvn = asset_dir.join("vad.mvn");
        if !am_mvn.exists() && vad_mvn.is_file() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;
                if am_mvn.exists() {
                    let _ = std::fs::remove_file(&am_mvn);
                }
                symlink("vad.mvn", &am_mvn).map_err(|e| format!("创建 am.mvn 链接失败: {e}"))?;
            }
            #[cfg(not(unix))]
            {
                std::fs::copy(&vad_mvn, &am_mvn)
                    .map_err(|e| format!("创建 am.mvn 副本失败: {e}"))?;
            }
        }
    }

    let _ = app.emit("model-download-progress", ModelDownloadProgress {
        model_id: asset_id.clone(),
        current_file: "done".into(),
        file_index: asset.files.len(),
        total_files: asset.files.len(),
        downloaded_bytes: total_bytes,
        total_bytes,
        status: "complete".into(),
        error: None,
    });

    Ok(Some(asset_dir.to_string_lossy().to_string()))
}

/// 一键下载所有共享资源 + 模型
#[tauri::command]
pub async fn download_all_models_and_assets(app: AppHandle) -> Result<AllModelsStatus, String> {
    let manifest = model_manifest::load_manifest(&app)?;

    // 1. 先下载所有共享资源
    for asset in &manifest.shared_assets {
        let _ = download_shared_asset(app.clone(), asset.id.clone()).await;
    }

    // 2. 下载所有 enabled 模型
    for model in enabled_models(manifest) {
        let _ = download_model(app.clone(), model.id.clone()).await;
    }

    // 返回最新状态
    check_all_models_downloaded(app.clone())
}

// --- 内部下载辅助 ---

/// 从镜像 resolve 前缀按 manifest.files 逐文件下载（HF-Mirror / ModelScope）
async fn download_model_files_from_base(
    app: &AppHandle,
    source: &model_manifest::DownloadSource,
    files: &[model_manifest::ManifestFile],
    dest_dir: &std::path::Path,
    model_id: &str,
) -> Result<(), String> {
    let mut base = source.url.trim().to_string();
    if !base.ends_with('/') {
        base.push('/');
    }

    let total_files = files.len();
    let total_bytes: u64 = 0;

    for (idx, file) in files.iter().enumerate() {
        let file_path = dest_dir.join(&file.path);
        let file_url = format!("{base}{}", file.path);

        let per_file_source = model_manifest::DownloadSource {
            region: source.region.clone(),
            provider: source.provider.clone(),
            url: file_url,
            verify_before_use: source.verify_before_use,
            download_mode: None,
        };
        let sources = [&per_file_source];

        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: model_id.to_string(),
            current_file: file.path.clone(),
            file_index: idx,
            total_files,
            downloaded_bytes: 0,
            total_bytes,
            status: "downloading".into(),
            error: None,
        });

        download_single_file_with_retries(
            app,
            &sources,
            &file_path,
            model_id,
            idx + 1,
            total_files,
            total_bytes,
        )
        .await?;
    }

    Ok(())
}

/// 多镜像重试下载归档文件
async fn download_archive_with_retries(
    app: &AppHandle,
    sources: &[&model_manifest::DownloadSource],
    archive_path: &std::path::Path,
    model_id: &str,
    total_bytes: u64,
) -> Result<u64, String> {
    let emit_error = |app: &AppHandle, msg: &str| {
        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: model_id.to_string(),
            current_file: String::new(),
            file_index: 0,
            total_files: 1,
            downloaded_bytes: 0,
            total_bytes,
            status: "error".into(),
            error: Some(msg.to_string()),
        });
    };

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

    let max_attempts = sources.len() as u32;
    let mut last_error: Option<String> = None;
    let mut downloaded: u64 = 0;

    'retry: for (attempt, source) in sources.iter().enumerate() {
        let attempt = attempt as u32 + 1;
        eprintln!(
            "[model] 下载归档 (尝试 {}/{}): {}",
            attempt, max_attempts, source.url
        );

        // 检查断点续传
        let mut resume_from = if archive_path.exists() {
            std::fs::metadata(archive_path).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        // 续传前校验已有 .tmp 是否为有效 bzip2（魔数 BZh）。
        // 若前次下载到 HTML 仓库页面等非归档内容，删除后从头重下，避免拼接出损坏文件。
        if resume_from > 0 {
            let valid_bz2 = std::fs::File::open(archive_path)
                .and_then(|mut f| {
                    use std::io::Read;
                    let mut buf = [0u8; 3];
                    f.read_exact(&mut buf).map(|_| &buf == b"BZh")
                })
                .unwrap_or(false);
            if !valid_bz2 {
                eprintln!("[model] 已有 .tmp 非 bzip2，删除重下");
                let _ = std::fs::remove_file(archive_path);
                resume_from = 0;
            }
        }

        let mut dest = if resume_from > 0 {
            eprintln!("[model] 续传从 {} 字节开始", resume_from);
            std::fs::OpenOptions::new().append(true).open(archive_path)
        } else {
            std::fs::File::create(archive_path)
        }
        .map_err(|e| {
            let msg = format!("无法写入文件 {}: {e}", archive_path.display());
            emit_error(app, &msg);
            msg
        })?;

        downloaded = resume_from;

        let mut request = client.get(source.url.as_str());
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
        if !status.is_success() {
            last_error = Some(format!("HTTP {}", status));
            eprintln!("[model] HTTP 错误 (尝试 {}/{}): {}", attempt, max_attempts, status);
            if attempt < max_attempts {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                continue 'retry;
            }
            break 'retry;
        }

        // 校验 Content-Type：拒绝 HTML 仓库页面（如 hf-mirror/huggingface 仓库主页 URL）。
        // 这类 URL 返回 200 + text/html，旧逻辑会当成归档接收，随后 bzip2 解码必然失败。
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        if content_type.contains("text/html") {
            last_error = Some(format!(
                "源返回 HTML 页面（Content-Type: {content_type}）而非归档，URL 可能指向仓库主页: {}",
                source.url
            ));
            eprintln!(
                "[model] 源返回 HTML，跳过 (尝试 {}/{}): {}",
                attempt, max_attempts, source.url
            );
            // 清掉本次误写入的空 .tmp，避免后续续传逻辑误判
            let _ = std::fs::remove_file(archive_path);
            if attempt < max_attempts {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue 'retry;
            }
            break 'retry;
        }

        let is_resumed = status.as_u16() == 206;
        if !is_resumed && resume_from > 0 {
            eprintln!("[model] 服务器不支持续传，重新下载");
            downloaded = 0;
            dest = std::fs::File::create(archive_path).map_err(|e| {
                let msg = format!("无法写入文件 {}: {e}", archive_path.display());
                emit_error(app, &msg);
                msg
            })?;
        }

        use futures::StreamExt;
        let mut stream = response.bytes_stream();
        let mut stream_error = false;
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk_result) = stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    last_error = Some(format!("下载数据出错: {e}"));
                    eprintln!("[model] 数据流中断 (尝试 {}/{}): {e}", attempt, max_attempts);
                    stream_error = true;
                    break;
                }
            };

            // 校验首个数据块是否为 bzip2 魔数 BZh（防止 Content-Type 漏判时把 HTML/JSON 当成归档）。
            // 仅在非续传的首块（downloaded == 0）校验，避免续传时误判中途数据。
            if downloaded == 0 && chunk.len() >= 3 && !chunk.starts_with(b"BZh") {
                last_error = Some(format!(
                    "源返回的内容不是 bzip2 归档（首块缺少 BZh 魔数），URL 可能指向仓库主页: {}",
                    source.url
                ));
                eprintln!(
                    "[model] 首块非 bzip2，跳过 (尝试 {}/{}): {}",
                    attempt, max_attempts, source.url
                );
                stream_error = true;
                // 不写入这块无效数据，清掉空 .tmp 后尝试下一个镜像
                let _ = std::fs::remove_file(archive_path);
                break;
            }

            if let Err(e) = dest.write_all(&chunk) {
                let msg = format!("写入文件出错 {}: {e}", archive_path.display());
                emit_error(app, &msg);
                let _ = std::fs::remove_file(archive_path);
                return Err(msg);
            }

            downloaded += chunk.len() as u64;

            if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
                let _ = app.emit("model-download-progress", ModelDownloadProgress {
                    model_id: model_id.to_string(),
                    current_file: "下载归档".into(),
                    file_index: 0,
                    total_files: 1,
                    downloaded_bytes: downloaded,
                    total_bytes,
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

        // 成功
        return Ok(downloaded);
    }

    // 所有镜像均失败
    let err = last_error.unwrap_or_else(|| "未知错误".into());
    let msg = format!(
        "下载失败：{}（已尝试 {} 个镜像源）。可能原因：网络不稳定，请检查网络后重试。",
        err, max_attempts
    );
    emit_error(app, &msg);
    let _ = std::fs::remove_file(archive_path);
    Err(msg)
}

/// 下载单个文件（用于 shared_assets），多镜像重试
async fn download_single_file_with_retries(
    app: &AppHandle,
    sources: &[&model_manifest::DownloadSource],
    file_path: &std::path::Path,
    asset_id: &str,
    file_index: usize,
    total_files: usize,
    total_bytes: u64,
) -> Result<u64, String> {
    let emit_error = |app: &AppHandle, msg: &str| {
        let _ = app.emit("model-download-progress", ModelDownloadProgress {
            model_id: asset_id.to_string(),
            current_file: String::new(),
            file_index,
            total_files,
            downloaded_bytes: 0,
            total_bytes,
            status: "error".into(),
            error: Some(msg.to_string()),
        });
    };

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

    let max_attempts = sources.len() as u32;
    let mut last_error: Option<String> = None;
    let mut downloaded: u64 = 0;

    'retry: for (attempt, source) in sources.iter().enumerate() {
        let attempt = attempt as u32 + 1;
        eprintln!(
            "[asset] 下载 {} (尝试 {}/{}): {}",
            file_path.display(),
            attempt, max_attempts, source.url
        );

        let resume_from = if file_path.exists() {
            std::fs::metadata(file_path).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        let mut dest = if resume_from > 0 {
            std::fs::OpenOptions::new().append(true).open(file_path)
        } else {
            std::fs::File::create(file_path)
        }
        .map_err(|e| {
            let msg = format!("无法写入文件 {}: {e}", file_path.display());
            emit_error(app, &msg);
            msg
        })?;

        downloaded = resume_from;

        let mut request = client.get(source.url.as_str());
        if resume_from > 0 {
            request = request.header("Range", format!("bytes={}-", resume_from));
        }

        let response = match request.send().await {
            Ok(resp) => resp,
            Err(e) => {
                last_error = Some(format!("连接失败: {e}"));
                if attempt < max_attempts {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue 'retry;
                }
                break 'retry;
            }
        };

        let status = response.status();
        if !status.is_success() {
            last_error = Some(format!("HTTP {}", status));
            if attempt < max_attempts {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                continue 'retry;
            }
            break 'retry;
        }

        // 校验 Content-Type：拒绝 HTML 仓库页面（与归档下载相同的防护）
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        if content_type.contains("text/html") {
            last_error = Some(format!(
                "源返回 HTML 页面（Content-Type: {content_type}）而非文件，URL 可能指向仓库主页: {}",
                source.url
            ));
            eprintln!(
                "[asset] 源返回 HTML，跳过 (尝试 {}/{}): {}",
                attempt, max_attempts, source.url
            );
            let _ = std::fs::remove_file(file_path);
            if attempt < max_attempts {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue 'retry;
            }
            break 'retry;
        }

        let is_resumed = status.as_u16() == 206;
        if !is_resumed && resume_from > 0 {
            downloaded = 0;
            dest = std::fs::File::create(file_path).map_err(|e| {
                let msg = format!("无法写入文件 {}: {e}", file_path.display());
                emit_error(app, &msg);
                msg
            })?;
        }

        use futures::StreamExt;
        let mut stream = response.bytes_stream();
        let mut stream_error = false;
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk_result) = stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    last_error = Some(format!("下载数据出错: {e}"));
                    stream_error = true;
                    break;
                }
            };

            if let Err(e) = dest.write_all(&chunk) {
                let msg = format!("写入文件出错 {}: {e}", file_path.display());
                emit_error(app, &msg);
                let _ = std::fs::remove_file(file_path);
                return Err(msg);
            }

            downloaded += chunk.len() as u64;

            if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
                let _ = app.emit("model-download-progress", ModelDownloadProgress {
                    model_id: asset_id.to_string(),
                    current_file: file_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                    file_index,
                    total_files,
                    downloaded_bytes: downloaded,
                    total_bytes,
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

        return Ok(downloaded);
    }

    let err = last_error.unwrap_or_else(|| "未知错误".into());
    let msg = format!(
        "下载失败：{}（已尝试 {} 个镜像源）",
        err, max_attempts
    );
    emit_error(app, &msg);
    let _ = std::fs::remove_file(file_path);
    Err(msg)
}

/// 解压 .tar.bz2 归档到目标目录，仅保留 extract_dir 子目录的内容
fn extract_tar_bz2<'a>(
    archive_path: &'a std::path::Path,
    dest_dir: &'a std::path::Path,
    extract_dir: &'a str,
) -> impl std::future::Future<Output = Result<(), String>> + Send + 'a {
    use std::io::Cursor;

    let archive_path = archive_path.to_path_buf();
    let dest_dir = dest_dir.to_path_buf();
    let extract_dir = extract_dir.to_string();

    async move {
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let archive_bytes = std::fs::read(&archive_path)
                .map_err(|e| format!("读取归档失败: {e}"))?;

            let cursor = Cursor::new(archive_bytes);
            let bz2_decoder = bzip2::read::BzDecoder::new(cursor);
            let mut archive = tar::Archive::new(bz2_decoder);

            // 解压到临时目录，然后把 extract_dir 内容移动到 dest_dir
            let temp_dir = dest_dir.join(".extract_tmp");
            if temp_dir.exists() {
                let _ = std::fs::remove_dir_all(&temp_dir);
            }
            std::fs::create_dir_all(&temp_dir)
                .map_err(|e| format!("创建临时目录失败: {e}"))?;

            archive
                .unpack(&temp_dir)
                .map_err(|e| format!("解压失败: {e}"))?;

            // tar 包内顶层通常是 extract_dir 目录
            let extracted_root = temp_dir.join(&extract_dir);
            let source_dir = if extracted_root.is_dir() {
                extracted_root
            } else {
                // 兜底：tar 内没有 extract_dir 顶层，直接用 temp_dir
                temp_dir.clone()
            };

            // 移动所有文件到 dest_dir
            if let Ok(entries) = std::fs::read_dir(&source_dir) {
                for entry in entries.flatten() {
                    let from = entry.path();
                    let file_name = entry.file_name();
                    let to = dest_dir.join(&file_name);
                    // 如果目标已存在，先删除（覆盖）
                    if to.exists() {
                        if to.is_dir() {
                            let _ = std::fs::remove_dir_all(&to);
                        } else {
                            let _ = std::fs::remove_file(&to);
                        }
                    }
                    std::fs::rename(&from, &to)
                        .or_else(|_| {
                            // rename 跨设备会失败，fallback 到 copy + remove
                            copy_recursive(&from, &to)?;
                            if from.is_dir() {
                                std::fs::remove_dir_all(&from)
                            } else {
                                std::fs::remove_file(&from)
                            }
                        })
                        .map_err(|e| format!("移动文件失败 {} → {}: {e}", from.display(), to.display()))?;
                }
            }

            // 清理临时目录
            let _ = std::fs::remove_dir_all(&temp_dir);

            Ok(())
        })
        .await
        .map_err(|e| format!("解压任务失败: {e}"))?
    }
}

fn copy_recursive(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    if from.is_dir() {
        std::fs::create_dir_all(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            let new_from = entry.path();
            let new_to = to.join(entry.file_name());
            copy_recursive(&new_from, &new_to)?;
        }
    } else {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(from, to)?;
    }
    Ok(())
}
