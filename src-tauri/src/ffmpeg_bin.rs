use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FfmpegSource {
    Bundled,
    System,
}

pub struct ResolvedFfmpeg {
    pub path: PathBuf,
    pub source: FfmpegSource,
}

pub fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

/// 解析 FFmpeg 可执行文件：优先使用打包在 binaries/ 内的副本，再回退系统 PATH。
pub fn resolve_ffmpeg(app: Option<&AppHandle>) -> Result<ResolvedFfmpeg, String> {
    let name = binary_name();

    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled = resource_dir.join("binaries").join(name);
            if bundled.is_file() {
                return Ok(ResolvedFfmpeg {
                    path: bundled,
                    source: FfmpegSource::Bundled,
                });
            }
        }
    }

    let manifest_bin = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(name);
    if manifest_bin.is_file() {
        return Ok(ResolvedFfmpeg {
            path: manifest_bin,
            source: FfmpegSource::Bundled,
        });
    }

    let cwd_dev = PathBuf::from("src-tauri").join("binaries").join(name);
    if cwd_dev.is_file() {
        return Ok(ResolvedFfmpeg {
            path: cwd_dev.canonicalize().unwrap_or(cwd_dev),
            source: FfmpegSource::Bundled,
        });
    }

    let system_name = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    if verify_ffmpeg(Path::new(system_name)).is_ok() {
        return Ok(ResolvedFfmpeg {
            path: PathBuf::from(system_name),
            source: FfmpegSource::System,
        });
    }

    Err(format!(
        "未找到 FFmpeg。请运行 pnpm fetch:ffmpeg 将内置二进制下载到 src-tauri/binaries/{name}，或安装系统 ffmpeg 并加入 PATH。"
    ))
}

/// 执行 `ffmpeg -version` 验证可用性，返回首行版本信息。
pub fn verify_ffmpeg(path: &Path) -> Result<String, String> {
    let output = Command::new(path)
        .arg("-version")
        .output()
        .map_err(|e| format!("无法调用 ffmpeg ({}): {e}", path.display()))?;

    if !output.status.success() {
        return Err(format!("ffmpeg 不可用 ({})", path.display()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next().unwrap_or("ffmpeg").trim().to_string();
    Ok(first_line)
}