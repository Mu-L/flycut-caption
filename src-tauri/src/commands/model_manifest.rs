// models.json 单一数据源解析模块
// 启动时从 resource_dir/models.json 或 dev 路径 src-tauri/models.json 读取并缓存
// 运行时只读访问，修改 models.json 需要重启应用

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

// --- 与 models.json 完全对齐的 serde 类型 ---

#[derive(Debug, Clone, Deserialize)]
pub struct ModelManifest {
    pub schema_version: i32,
    #[allow(dead_code)]
    pub name: String,
    #[allow(dead_code)]
    pub description: String,
    #[allow(dead_code)]
    pub runtime: serde_json::Value,
    #[allow(dead_code)]
    pub timestamp_policy: serde_json::Value,
    #[serde(default)]
    pub shared_assets: Vec<SharedAsset>,
    pub models: Vec<ManifestModel>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SharedAsset {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub description: String,
    pub required_for_subtitle: bool,
    pub files: Vec<ManifestFile>,
    pub download_sources: Vec<DownloadSource>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManifestModel {
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
    #[serde(default = "default_true")]
    pub supports_subtitle: bool,
    #[serde(default = "default_model_timestamp")]
    pub timestamp: ModelTimestamp,
    pub artifact: Artifact,
    pub files: Vec<ManifestFile>,
    /// 保留为 serde_json::Value，sidecar 端按 model_type 反序列化为对应类型。
    /// 这样 manifest 解析层不需要为 8 个 family 各写一份 struct。
    pub recognizer_config: serde_json::Value,
    pub download_sources: Vec<DownloadSource>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManifestFile {
    pub path: String,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Artifact {
    pub archive_name: String,
    pub extract_dir: String,
    #[serde(default)]
    pub size_mb_estimate: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DownloadSource {
    pub region: String,
    pub provider: String,
    pub url: String,
    #[serde(default)]
    pub verify_before_use: Option<bool>,
    /// `files`：按 manifest.files 逐文件从 url 前缀下载；缺省或 `archive`：下载单个 .tar.bz2 归档
    #[serde(default)]
    pub download_mode: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelTimestamp {
    pub level: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub required_vad: Option<bool>,
    #[serde(default)]
    pub token_timestamp_verified: bool,
}

fn default_model_timestamp() -> ModelTimestamp {
    ModelTimestamp {
        level: "segment".to_string(),
        source: Some("vad".to_string()),
        required_vad: Some(true),
        token_timestamp_verified: false,
    }
}

// --- 全局缓存 ---

static MANIFEST: OnceLock<ModelManifest> = OnceLock::new();

/// 加载 manifest，首次调用从磁盘读取并缓存，后续调用直接返回引用
pub fn load_manifest(app: &AppHandle) -> Result<&'static ModelManifest, String> {
    if let Some(m) = MANIFEST.get() {
        return Ok(m);
    }

    let content = read_manifest_file(app)?;
    let manifest: ModelManifest = serde_json::from_str(&content)
        .map_err(|e| format!("解析 models.json 失败：{e}"))?;

    // OnceLock::set 失败说明并发情况下另一个线程先 set 了，直接 get 即可
    let _ = MANIFEST.set(manifest);
    Ok(MANIFEST.get().expect("manifest must be set"))
}

fn read_manifest_file(app: &AppHandle) -> Result<String, String> {
    // 1. resource_dir 下的候选：
    //    - 生产：tauri.conf.json::resources "models.json" 直接落在 resource_dir 根
    //    - 开发：resources 配置为 "../models.json"，Tauri 把 "../" 映射为 "_up_/"，
    //      文件实际位于 resource_dir/_up_/models.json（已验证 dev 下 cwd 是 src-tauri/，
    //      旧版相对路径会解析到 src-tauri/src-tauri/ 从而全部 miss）
    if let Ok(resource_dir) = app.path().resource_dir() {
        for candidate in [
            resource_dir.join("models.json"),
            resource_dir.join("_up_").join("models.json"),
        ] {
            if candidate.is_file() {
                return std::fs::read_to_string(&candidate)
                    .map_err(|e| format!("读取 {} 失败：{e}", candidate.display()));
            }
        }
    }

    // 2. 开发模式 fallback：CARGO_MANIFEST_DIR 是编译期 src-tauri 目录的绝对路径，
    //    不依赖运行时 cwd。仅 debug 构建启用，避免 release 里泄露构建机路径。
    #[cfg(debug_assertions)]
    {
        let dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("models.json");
        if dev_candidate.is_file() {
            return std::fs::read_to_string(&dev_candidate)
                .map_err(|e| format!("读取 {} 失败：{e}", dev_candidate.display()));
        }
    }

    // 3. cwd 兜底（兼容自定义部署：项目根或 src-tauri 下放置 models.json）
    for rel in ["models.json", "src-tauri/models.json"] {
        let p = PathBuf::from(rel);
        if p.is_file() {
            return std::fs::read_to_string(&p)
                .map_err(|e| format!("读取 {} 失败：{e}", p.display()));
        }
    }

    Err(
        "未找到 models.json：请确认 tauri.conf.json::resources 包含 \"../models.json\"，\
         或在项目根放置 models.json"
            .to_string(),
    )
}

// --- 查询辅助 ---

/// 返回所有 enabled=true 的模型
pub fn enabled_models(manifest: &ModelManifest) -> Vec<&ManifestModel> {
    manifest.models.iter().filter(|m| m.enabled).collect()
}

/// 按 model_id 查找单个模型（不要求 enabled）
pub fn find_model<'a>(manifest: &'a ModelManifest, model_id: &str) -> Option<&'a ManifestModel> {
    manifest.models.iter().find(|m| m.id == model_id)
}

/// 按 asset_id 查找共享资源（如 silero-vad）
pub fn find_shared_asset<'a>(
    manifest: &'a ModelManifest,
    asset_id: &str,
) -> Option<&'a SharedAsset> {
    manifest.shared_assets.iter().find(|a| a.id == asset_id)
}

/// 是否为按文件下载的镜像前缀（HF / ModelScope resolve 目录）
pub fn is_file_mode_source(source: &DownloadSource) -> bool {
    source.download_mode.as_deref() == Some("files") || source.url.ends_with('/')
}

/// 下载源排序：files 镜像 → 单文件直链 → 归档直链；同 tier 内 cn 优先。
pub fn sorted_download_sources(sources: &[DownloadSource]) -> Vec<&DownloadSource> {
    fn is_direct_file_url(url: &str) -> bool {
        url.ends_with(".onnx")
    }

    fn is_archive_url(url: &str) -> bool {
        url.ends_with(".tar.bz2")
    }

    let mut sorted: Vec<&DownloadSource> = sources.iter().collect();
    sorted.sort_by_key(|s| {
        let tier = if is_file_mode_source(s) {
            0
        } else if is_direct_file_url(&s.url) {
            1
        } else if is_archive_url(&s.url) {
            2
        } else {
            3
        };
        let region_rank = match s.region.as_str() {
            "cn" => 0,
            _ => 1,
        };
        (tier, region_rank)
    });
    sorted
}
