use crate::ffmpeg_bin::{self, FfmpegSource, ResolvedFfmpeg};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSegmentInput {
    pub start: f64,
    pub end: f64,
    pub keep: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessVideoOptions {
    pub input_path: String,
    pub segments: Vec<VideoSegmentInput>,
    pub output_format: String,
    pub quality: String,
    pub preserve_audio: bool,
    /// none | soft | hard
    pub subtitle_processing: String,
    pub ass_content: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessVideoResult {
    pub output_path: String,
}

fn crf_for_quality(quality: &str) -> &'static str {
    match quality {
        "high" => "18",
        "low" => "28",
        _ => "23",
    }
}

fn escape_ass_filter_path(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('\\', "/");
    if let Some(idx) = s.find(':') {
        // Windows: C:/path -> C\:/path
        let drive = &s[..idx];
        let rest = &s[idx + 1..];
        s = format!("{drive}\\:{rest}");
    }
    s.replace('\'', "'\\''")
}

fn resolve_subtitle_fonts_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("shared_assets").join("subtitle-fonts");
        if bundled.is_dir() {
            return Some(bundled);
        }
    }

    #[cfg(debug_assertions)]
    {
        let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("shared_assets")
            .join("subtitle-fonts");
        if dev_dir.is_dir() {
            return Some(dev_dir);
        }
    }

    None
}

fn build_ass_video_filter(ass_path: &Path, fonts_dir: Option<&Path>) -> String {
    let escaped_ass = escape_ass_filter_path(ass_path);
    match fonts_dir {
        Some(dir) if dir.is_dir() => {
            let escaped_fonts = escape_ass_filter_path(dir);
            format!("ass=filename='{escaped_ass}':fontsdir='{escaped_fonts}'")
        }
        _ => format!("ass='{escaped_ass}'"),
    }
}

fn cleanup_stale_export_files(work_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(work_dir) else {
        return;
    };

    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(24 * 60 * 60))
        .unwrap_or(std::time::UNIX_EPOCH);

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !(name.starts_with("cut_")
            || name.starts_with("subs_")
            || name.starts_with("output_"))
        {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
}

fn emit_progress(app: &AppHandle, stage: &str, progress: f64, message: &str) {
    let _ = app.emit(
        "video-process-progress",
        serde_json::json!({
            "stage": stage,
            "progress": progress,
            "message": message,
        }),
    );
}

fn run_ffmpeg(
    app: &AppHandle,
    ffmpeg: &Path,
    args: &[String],
    message: &str,
) -> Result<(), String> {
    emit_progress(app, "encoding", 50.0, message);

    let mut child = Command::new(ffmpeg)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;

    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if line.contains("time=") {
                emit_progress(app, "encoding", 65.0, "处理中...");
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("等待 ffmpeg 失败: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("ffmpeg 命令失败 (exit={status})"))
    }
}

fn build_cut_args(
    input_path: &str,
    output_path: &Path,
    kept: &[&VideoSegmentInput],
    preserve_audio: bool,
    crf: &str,
) -> Result<Vec<String>, String> {
    let mut args = vec!["-y".to_string()];

    if kept.len() == 1 {
        let seg = kept[0];
        args.push("-ss".into());
        args.push(seg.start.to_string());
        args.push("-i".into());
        args.push(input_path.into());
        args.push("-t".into());
        args.push((seg.end - seg.start).to_string());
    } else {
        args.push("-i".into());
        args.push(input_path.into());

        let mut filter = String::new();
        for (i, seg) in kept.iter().enumerate() {
            filter.push_str(&format!(
                "[0:v]trim=start={}:end={},setpts=PTS-STARTPTS[v{i}];",
                seg.start, seg.end
            ));
            if preserve_audio {
                filter.push_str(&format!(
                    "[0:a]atrim=start={}:end={},asetpts=PTS-STARTPTS[a{i}];",
                    seg.start, seg.end
                ));
            }
        }

        let n = kept.len();
        for i in 0..n {
            filter.push_str(&format!("[v{i}]"));
        }
        filter.push_str(&format!("concat=n={n}:v=1:a=0[outv]"));

        if preserve_audio {
            filter.push(';');
            for i in 0..n {
                filter.push_str(&format!("[a{i}]"));
            }
            filter.push_str(&format!("concat=n={n}:v=0:a=1[outa]"));
            args.push("-filter_complex".into());
            args.push(filter);
            args.push("-map".into());
            args.push("[outv]".into());
            args.push("-map".into());
            args.push("[outa]".into());
        } else {
            args.push("-filter_complex".into());
            args.push(filter);
            args.push("-map".into());
            args.push("[outv]".into());
        }
    }

    args.push("-c:v".into());
    args.push("libx264".into());
    args.push("-crf".into());
    args.push(crf.into());

    if preserve_audio {
        args.push("-c:a".into());
        args.push("aac".into());
    } else {
        args.push("-an".into());
    }

    args.push(output_path.to_string_lossy().to_string());
    Ok(args)
}

fn process_video_blocking(app: AppHandle, options: ProcessVideoOptions) -> Result<ProcessVideoResult, String> {
    let resolved = ffmpeg_bin::resolve_ffmpeg(Some(&app))?;
    ffmpeg_bin::verify_ffmpeg(&resolved.path)?;

    let input = PathBuf::from(&options.input_path);
    if !input.is_file() {
        return Err(format!("输入视频不存在: {}", options.input_path));
    }

    let kept: Vec<&VideoSegmentInput> = options.segments.iter().filter(|s| s.keep).collect();
    if kept.is_empty() {
        return Err("没有要保留的视频片段".into());
    }

    let work_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("video-export");
    std::fs::create_dir_all(&work_dir).map_err(|e| e.to_string())?;
    cleanup_stale_export_files(&work_dir);

    let fonts_dir = resolve_subtitle_fonts_dir(&app);

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();

    let cut_path = work_dir.join(format!("cut_{ts}.mp4"));
    let ass_path = work_dir.join(format!("subs_{ts}.ass"));
    let output_path = work_dir.join(format!(
        "output_{ts}.{}",
        options.output_format.trim_start_matches('.')
    ));

    let crf = crf_for_quality(&options.quality);

    emit_progress(&app, "cutting", 15.0, "裁剪视频片段...");
    let cut_args = build_cut_args(
        &options.input_path,
        &cut_path,
        &kept,
        options.preserve_audio,
        crf,
    )?;
    run_ffmpeg(&app, &resolved.path, &cut_args, "裁剪并拼接视频...")?;

    let burn_subs = options.subtitle_processing != "none" && options.ass_content.is_some();

    if !burn_subs {
        std::fs::rename(&cut_path, &output_path).or_else(|_| {
            std::fs::copy(&cut_path, &output_path)?;
            std::fs::remove_file(&cut_path)?;
            Ok::<(), std::io::Error>(())
        })
        .map_err(|e| format!("保存输出失败: {e}"))?;

        emit_progress(&app, "complete", 100.0, "视频导出完成");
        return Ok(ProcessVideoResult {
            output_path: output_path.to_string_lossy().to_string(),
        });
    }

    let ass_content = options.ass_content.unwrap();
    std::fs::write(&ass_path, ass_content).map_err(|e| format!("写入 ASS 字幕失败: {e}"))?;

    if options.subtitle_processing == "hard" {
        emit_progress(&app, "encoding", 75.0, "FFmpeg 硬烧录字幕...");
        let vf = build_ass_video_filter(&ass_path, fonts_dir.as_deref());
        let burn_args = vec![
            "-y".into(),
            "-i".into(),
            cut_path.to_string_lossy().to_string(),
            "-vf".into(),
            vf,
            "-c:v".into(),
            "libx264".into(),
            "-crf".into(),
            crf.into(),
            "-c:a".into(),
            "copy".into(),
            output_path.to_string_lossy().to_string(),
        ];
        run_ffmpeg(&app, &resolved.path, &burn_args, "硬烧录字幕...")?;
    } else {
        emit_progress(&app, "encoding", 75.0, "FFmpeg 嵌入软字幕轨道...");
        let mux_args = if options.preserve_audio {
            vec![
                "-y".into(),
                "-i".into(),
                cut_path.to_string_lossy().to_string(),
                "-i".into(),
                ass_path.to_string_lossy().to_string(),
                "-map".into(),
                "0:v:0".into(),
                "-map".into(),
                "0:a:0?".into(),
                "-map".into(),
                "1:s:0".into(),
                "-c:v".into(),
                "copy".into(),
                "-c:a".into(),
                "copy".into(),
                "-c:s".into(),
                "mov_text".into(),
                "-disposition:s:0".into(),
                "default".into(),
                output_path.to_string_lossy().to_string(),
            ]
        } else {
            vec![
                "-y".into(),
                "-i".into(),
                cut_path.to_string_lossy().to_string(),
                "-i".into(),
                ass_path.to_string_lossy().to_string(),
                "-map".into(),
                "0:v:0".into(),
                "-map".into(),
                "1:s:0".into(),
                "-c:v".into(),
                "copy".into(),
                "-c:s".into(),
                "mov_text".into(),
                "-disposition:s:0".into(),
                "default".into(),
                output_path.to_string_lossy().to_string(),
            ]
        };
        run_ffmpeg(&app, &resolved.path, &mux_args, "嵌入字幕轨道...")?;
    }

    let _ = std::fs::remove_file(&cut_path);
    let _ = std::fs::remove_file(&ass_path);

    emit_progress(&app, "complete", 100.0, "视频导出完成");
    Ok(ProcessVideoResult {
        output_path: output_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn check_ffmpeg_environment(app: AppHandle) -> Result<serde_json::Value, String> {
    match ffmpeg_bin::resolve_ffmpeg(Some(&app)) {
        Ok(ResolvedFfmpeg { path, source }) => {
            match ffmpeg_bin::verify_ffmpeg(&path) {
                Ok(version) => Ok(serde_json::json!({
                    "available": true,
                    "source": match source {
                        FfmpegSource::Bundled => "bundled",
                        FfmpegSource::System => "system",
                    },
                    "path": path.display().to_string(),
                    "version": version,
                })),
                Err(error) => Ok(serde_json::json!({
                    "available": false,
                    "error": error,
                })),
            }
        }
        Err(error) => Ok(serde_json::json!({
            "available": false,
            "error": error,
        })),
    }
}

#[tauri::command]
pub async fn process_video_with_ffmpeg(
    app: AppHandle,
    options: ProcessVideoOptions,
) -> Result<ProcessVideoResult, String> {
    tauri::async_runtime::spawn_blocking(move || process_video_blocking(app, options))
        .await
        .map_err(|e| format!("视频处理任务异常: {e}"))?
}