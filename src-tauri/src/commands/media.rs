use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn flycut_temp_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("flycut-caption");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败: {e}"))?;
    Ok(dir)
}

fn sanitize_file_name(name: &str) -> String {
    let fallback = "media.bin";
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    let base = Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback);
    base.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn unique_temp_path(file_name: &str) -> Result<PathBuf, String> {
    let dir = flycut_temp_dir()?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    Ok(dir.join(format!("{ts}-{}", sanitize_file_name(file_name))))
}

/// 将前端传入的媒体字节写入临时文件，供 FunASR / FFmpeg 使用本地路径。
#[tauri::command]
pub async fn stage_media_file(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("媒体数据为空".to_string());
    }
    let path = unique_temp_path(&file_name)?;
    std::fs::write(&path, bytes).map_err(|e| format!("写入临时媒体文件失败: {e}"))?;
    Ok(path.display().to_string())
}

/// 从 http(s) URL 下载媒体到临时文件，供 Tauri 本地引擎处理。
#[tauri::command]
pub async fn download_media_to_temp(
    url: String,
    file_name: Option<String>,
) -> Result<String, String> {
    let parsed = url.trim();
    if !(parsed.starts_with("http://") || parsed.starts_with("https://")) {
        return Err("仅支持 http/https URL".to_string());
    }

    let response = reqwest::get(parsed)
        .await
        .map_err(|e| format!("下载失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }

    let derived_name = file_name.unwrap_or_else(|| {
        parsed
            .split('/')
            .next_back()
            .unwrap_or("media.bin")
            .to_string()
    });
    let path = unique_temp_path(&derived_name)?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取下载内容失败: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("写入临时媒体文件失败: {e}"))?;
    Ok(path.display().to_string())
}
