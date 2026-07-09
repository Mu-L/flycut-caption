use crate::ffmpeg_bin::{self, FfmpegSource, ResolvedFfmpeg};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// 导出诊断日志：同时打到 stderr（Tauri 终端可见）并带统一前缀。
fn log_export(scope: &str, message: &str) {
    eprintln!("[flycut-export][{scope}] {message}");
}

fn log_export_success(output_path: &Path, started: Instant, route: &str) {
    let size = std::fs::metadata(output_path).map(|m| m.len()).unwrap_or(0);
    log_export(
        "export",
        &format!(
            "done route={route} elapsed={:.2}s output={} size_bytes={size}",
            started.elapsed().as_secs_f64(),
            output_path.display(),
        ),
    );
}

#[derive(Debug, Clone, Deserialize)]
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
    pub subtitle_text_content: Option<String>,
    /// 用户指定的输出绝对路径；未提供时写入应用缓存目录
    pub output_path: Option<String>,
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

/// x264 preset：在画质档位上偏向导出速度（默认 veryfast）。
fn x264_preset_for_quality(quality: &str) -> &'static str {
    match quality {
        "high" => "medium",
        "low" => "ultrafast",
        _ => "veryfast",
    }
}

fn vp9_crf_for_quality(quality: &str) -> &'static str {
    match quality {
        "high" => "28",
        "low" => "38",
        _ => "32",
    }
}

fn vp9_cpu_used_for_quality(quality: &str) -> &'static str {
    match quality {
        "high" => "2",
        "low" => "8",
        _ => "4",
    }
}

/// H.264 编码器：优先硬件，失败回落 libx264。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum H264Encoder {
    /// Apple VideoToolbox（macOS）
    VideoToolbox,
    /// NVIDIA NVENC（Windows/Linux）
    Nvenc,
    /// AMD AMF（Windows）
    Amf,
    /// Intel Quick Sync（Windows/Linux）
    Qsv,
    /// 软件编码回落
    Libx264,
}

impl H264Encoder {
    fn codec_name(self) -> &'static str {
        match self {
            Self::VideoToolbox => "h264_videotoolbox",
            Self::Nvenc => "h264_nvenc",
            Self::Amf => "h264_amf",
            Self::Qsv => "h264_qsv",
            Self::Libx264 => "libx264",
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::VideoToolbox => "VideoToolbox",
            Self::Nvenc => "NVENC",
            Self::Amf => "AMF",
            Self::Qsv => "Quick Sync",
            Self::Libx264 => "libx264",
        }
    }

    fn is_hardware(self) -> bool {
        !matches!(self, Self::Libx264)
    }

    fn from_codec_name(name: &str) -> Option<Self> {
        match name {
            "h264_videotoolbox" => Some(Self::VideoToolbox),
            "h264_nvenc" => Some(Self::Nvenc),
            "h264_amf" => Some(Self::Amf),
            "h264_qsv" => Some(Self::Qsv),
            "libx264" => Some(Self::Libx264),
            _ => None,
        }
    }
}

/// 平台优先硬件编码器列表（按优先级），最后总是可回落 libx264。
fn preferred_h264_codec_order() -> &'static [&'static str] {
    if cfg!(target_os = "macos") {
        &["h264_videotoolbox", "libx264"]
    } else if cfg!(target_os = "windows") {
        // NVIDIA > AMD > Intel，覆盖主流 Windows GPU
        &["h264_nvenc", "h264_amf", "h264_qsv", "libx264"]
    } else {
        &["h264_nvenc", "h264_qsv", "libx264"]
    }
}

/// 解析 `ffmpeg -encoders` 中已编译的 H.264 相关编码器名称。
fn list_ffmpeg_encoders(ffmpeg: &Path) -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();
    let Ok(output) = Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
    else {
        return set;
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim();
        // 典型行：` V....D h264_videotoolbox  VideoToolbox H.264 Encoder`
        let mut parts = trimmed.split_whitespace();
        let Some(flags) = parts.next() else {
            continue;
        };
        // 视频编码器标志列以 V 开头（如 V....D）
        if !flags.starts_with('V') || flags.len() < 5 {
            continue;
        }
        if let Some(name) = parts.next() {
            if name.starts_with("h264_") || name == "libx264" {
                set.insert(name.to_string());
            }
        }
    }
    set
}

/// 选择当前环境可用的最优 H.264 编码器。
fn select_h264_encoder(ffmpeg: &Path) -> H264Encoder {
    let available = list_ffmpeg_encoders(ffmpeg);
    for name in preferred_h264_codec_order() {
        if *name == "libx264" {
            return H264Encoder::Libx264;
        }
        if available.contains(*name) {
            if let Some(enc) = H264Encoder::from_codec_name(name) {
                return enc;
            }
        }
    }
    H264Encoder::Libx264
}

/// VideoToolbox 不支持 -q:v，使用目标码率近似画质档。
fn videotoolbox_bitrate(quality: &str) -> &'static str {
    match quality {
        "high" => "10M",
        "low" => "2500k",
        _ => "5M",
    }
}

fn nvenc_preset_for_quality(quality: &str) -> &'static str {
    match quality {
        "high" => "p5",
        "low" => "p1",
        _ => "p4",
    }
}

fn amf_quality_for_quality(quality: &str) -> &'static str {
    match quality {
        "high" => "quality",
        "low" => "speed",
        _ => "balanced",
    }
}

/// 追加 H.264 编码参数（硬件或软件）。
fn append_h264_encoder_args(args: &mut Vec<String>, encoder: H264Encoder, quality: &str) {
    args.push("-c:v".into());
    args.push(encoder.codec_name().into());

    match encoder {
        H264Encoder::Libx264 => {
            args.push("-preset".into());
            args.push(x264_preset_for_quality(quality).into());
            args.push("-crf".into());
            args.push(crf_for_quality(quality).into());
            args.push("-pix_fmt".into());
            args.push("yuv420p".into());
        }
        H264Encoder::VideoToolbox => {
            // 本仓库打包的 FFmpeg：VT 仅支持 -b:v，不支持 -q:v
            args.push("-b:v".into());
            args.push(videotoolbox_bitrate(quality).into());
            args.push("-profile:v".into());
            args.push("high".into());
            args.push("-pix_fmt".into());
            args.push("yuv420p".into());
            // 不设 allow_sw：硬编失败时由上层回落 libx264，避免 VT 软件路径极慢
        }
        H264Encoder::Nvenc => {
            args.push("-preset".into());
            args.push(nvenc_preset_for_quality(quality).into());
            args.push("-rc".into());
            args.push("vbr".into());
            args.push("-cq".into());
            args.push(crf_for_quality(quality).into());
            args.push("-b:v".into());
            args.push("0".into());
            args.push("-pix_fmt".into());
            args.push("yuv420p".into());
        }
        H264Encoder::Amf => {
            args.push("-quality".into());
            args.push(amf_quality_for_quality(quality).into());
            args.push("-rc".into());
            args.push("cqp".into());
            args.push("-qp_i".into());
            args.push(crf_for_quality(quality).into());
            args.push("-qp_p".into());
            args.push(crf_for_quality(quality).into());
            args.push("-pix_fmt".into());
            args.push("yuv420p".into());
        }
        H264Encoder::Qsv => {
            args.push("-global_quality".into());
            args.push(crf_for_quality(quality).into());
            // QSV 偏好 nv12；FFmpeg 会在需要时自动转换
            args.push("-pix_fmt".into());
            args.push("nv12".into());
        }
    }
}

/// 合并相邻且 keep 状态相同的片段，减少 trim/concat 段数。
fn merge_adjacent_segments(segments: &[VideoSegmentInput]) -> Vec<VideoSegmentInput> {
    let mut items: Vec<VideoSegmentInput> = segments
        .iter()
        .filter(|s| s.end > s.start)
        .map(|s| VideoSegmentInput {
            start: s.start,
            end: s.end,
            keep: s.keep,
        })
        .collect();

    items.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut merged: Vec<VideoSegmentInput> = Vec::with_capacity(items.len());
    for seg in items {
        if let Some(last) = merged.last_mut() {
            // 1ms 容差：字级时间戳浮点误差导致的微缝隙也合并
            if last.keep == seg.keep && seg.start <= last.end + 0.001 {
                last.end = last.end.max(seg.end);
                continue;
            }
        }
        merged.push(seg);
    }
    merged
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutputFormat {
    Mp4,
    Mov,
    Webm,
    Mkv,
}

impl OutputFormat {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim_start_matches('.').to_ascii_lowercase().as_str() {
            "mp4" => Ok(Self::Mp4),
            "mov" => Ok(Self::Mov),
            "webm" => Ok(Self::Webm),
            "mkv" => Ok(Self::Mkv),
            other => Err(format!("不支持的输出格式: {other}")),
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Mov => "mov",
            Self::Webm => "webm",
            Self::Mkv => "mkv",
        }
    }

    fn is_quicktime_family(self) -> bool {
        matches!(self, Self::Mp4 | Self::Mov)
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
    // shaping=simple：双语（中文主+英文副）时比 complex 更稳、更快，避免 libass 复杂 shaping 拖垮硬烧
    match fonts_dir {
        Some(dir) if dir.is_dir() => {
            let escaped_fonts = escape_ass_filter_path(dir);
            format!(
                "ass=filename='{escaped_ass}':fontsdir='{escaped_fonts}':shaping=simple"
            )
        }
        _ => format!("ass=filename='{escaped_ass}':shaping=simple"),
    }
}

/// 硬烧录用 ASS 预处理：
/// 1) 字体名映射到内置字体
/// 2) BorderStyle=3（不透明底框）改为描边样式——双语副字幕底框在 libass 里极慢
/// 3) WrapStyle 使用 0（智能换行），避免超长英文副字幕撑爆绘制
fn normalize_ass_for_hard_burn(ass: &str) -> String {
    let mut out = String::with_capacity(ass.len() + 64);
    for line in ass.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("WrapStyle:") {
            out.push_str("WrapStyle: 0\n");
            continue;
        }
        if let Some(rest) = line.strip_prefix("Style:") {
            // Style: Name,Fontname,Fontsize,Primary,Secondary,Outline,Back,Bold,Italic,Underline,
            //        StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Align,...
            let mut fields: Vec<String> = rest.split(',').map(|s| s.to_string()).collect();
            if fields.len() >= 2 {
                let mapped = map_burn_font_name(fields[1].trim());
                fields[1] = mapped.to_string();
            }
            // BorderStyle 字段 index 15（0=Name）
            if fields.len() > 16 {
                let border_style = fields[15].trim();
                if border_style == "3" {
                    fields[15] = "1".into();
                    // 底框改描边：保证至少 2px 外框，可读性接近底框
                    let outline = fields[16].trim().parse::<i32>().unwrap_or(0);
                    if outline < 2 {
                        fields[16] = "2".into();
                    }
                    // 描边色用原 BackColour 的可见部分不够通用；保留 OutlineColour
                }
            }
            out.push_str("Style:");
            out.push_str(&fields.join(","));
            out.push('\n');
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn map_burn_font_name(font: &str) -> &'static str {
    let lower = font.to_ascii_lowercase();
    if lower.contains("noto") || lower.contains("pingfang") || lower.contains("source han")
        || lower.contains("思源") || lower.contains("微软雅黑") || lower.contains("microsoft yahei")
        || lower.contains("sans sc")
    {
        "Noto Sans SC"
    } else if lower.contains("inter") {
        "Inter"
    } else if lower.contains("arial") || lower.contains("helvetica") || lower.contains("sans") {
        // 英文通用无衬线 → Inter（内置）
        "Inter"
    } else if lower.contains("georgia") || lower.contains("serif") || lower.contains("times") {
        "Inter"
    } else {
        // 未知字体统一落到中英皆可的 Noto Sans SC，避免系统字体回退
        "Noto Sans SC"
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
        if !(name.starts_with("cut_") || name.starts_with("subs_") || name.starts_with("output_")) {
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
    log_export(
        "progress",
        &format!("stage={stage} progress={progress:.1} msg={message}"),
    );
    let _ = app.emit(
        "video-process-progress",
        serde_json::json!({
            "stage": stage,
            "progress": progress,
            "message": message,
        }),
    );
}

/// 将 FFmpeg 命令参数格式化为可复制的 shell 风格字符串（仅用于日志）。
fn format_ffmpeg_command(ffmpeg: &Path, args: &[String]) -> String {
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(ffmpeg.display().to_string());
    for arg in args {
        if arg.is_empty() || arg.contains(char::is_whitespace) || arg.contains('\'') {
            parts.push(format!("'{}'", arg.replace('\'', "'\\''")));
        } else {
            parts.push(arg.clone());
        }
    }
    parts.join(" ")
}

/// 从 FFmpeg stderr 缓冲区中拆出完整“行”（兼容 \\n 与进度用的 \\r）。
fn drain_ffmpeg_stderr_lines(buffer: &mut String) -> Vec<String> {
    let mut lines = Vec::new();
    loop {
        let n_pos = buffer.find('\n');
        let r_pos = buffer.find('\r');
        let split_at = match (n_pos, r_pos) {
            (Some(n), Some(r)) => Some(n.min(r)),
            (Some(n), None) => Some(n),
            (None, Some(r)) => Some(r),
            (None, None) => None,
        };
        let Some(idx) = split_at else {
            break;
        };
        let line = buffer[..idx].to_string();
        // 跳过分隔符；处理 \r\n
        let mut consume = idx + 1;
        if buffer.as_bytes().get(idx) == Some(&b'\r') && buffer.as_bytes().get(idx + 1) == Some(&b'\n')
        {
            consume = idx + 2;
        }
        *buffer = buffer[consume..].to_string();
        if !line.is_empty() {
            lines.push(line);
        }
    }
    lines
}

fn parse_ffmpeg_clock_seconds(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    let parts: Vec<&str> = trimmed.split(':').collect();
    match parts.len() {
        3 => {
            let hours: f64 = parts[0].parse().ok()?;
            let minutes: f64 = parts[1].parse().ok()?;
            let seconds: f64 = parts[2].parse().ok()?;
            Some(hours * 3600.0 + minutes * 60.0 + seconds)
        }
        2 => {
            let minutes: f64 = parts[0].parse().ok()?;
            let seconds: f64 = parts[1].parse().ok()?;
            Some(minutes * 60.0 + seconds)
        }
        _ => None,
    }
}

fn extract_ffmpeg_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let idx = line.find(key)?;
    let rest = &line[idx + key.len()..];
    rest.split_whitespace().next()
}

fn lerp_progress(start: f64, end: f64, ratio: f64) -> f64 {
    start + (end - start) * ratio.clamp(0.0, 1.0)
}

fn copy_file_to_output(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {e}"))?;
    }
    std::fs::copy(src, dst).map_err(|e| format!("保存输出失败: {e}"))?;
    Ok(())
}

fn has_deleted_segments(segments: &[VideoSegmentInput]) -> bool {
    segments.iter().any(|segment| !segment.keep)
}

fn source_matches_output_format(path: &Path, format: OutputFormat) -> bool {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match format {
        OutputFormat::Mp4 => matches!(ext.as_str(), "mp4" | "m4v"),
        OutputFormat::Mov => ext == "mov",
        OutputFormat::Webm => ext == "webm",
        OutputFormat::Mkv => ext == "mkv",
    }
}

fn append_video_codec_args(
    args: &mut Vec<String>,
    format: OutputFormat,
    quality: &str,
    copy_video: bool,
    h264_encoder: H264Encoder,
) {
    if copy_video {
        args.push("-c:v".into());
        args.push("copy".into());
        return;
    }

    match format {
        OutputFormat::Webm => {
            args.push("-c:v".into());
            args.push("libvpx-vp9".into());
            args.push("-crf".into());
            args.push(vp9_crf_for_quality(quality).into());
            args.push("-b:v".into());
            args.push("0".into());
            args.push("-deadline".into());
            args.push("good".into());
            args.push("-cpu-used".into());
            args.push(vp9_cpu_used_for_quality(quality).into());
            args.push("-row-mt".into());
            args.push("1".into());
            args.push("-pix_fmt".into());
            args.push("yuv420p".into());
        }
        OutputFormat::Mp4 | OutputFormat::Mov | OutputFormat::Mkv => {
            append_h264_encoder_args(args, h264_encoder, quality);
        }
    }
}

fn append_audio_codec_args(
    args: &mut Vec<String>,
    format: OutputFormat,
    preserve_audio: bool,
    copy_audio: bool,
) {
    if !preserve_audio {
        args.push("-an".into());
        return;
    }

    args.push("-c:a".into());
    if copy_audio {
        args.push("copy".into());
        return;
    }

    match format {
        OutputFormat::Webm => args.push("libopus".into()),
        OutputFormat::Mp4 | OutputFormat::Mov | OutputFormat::Mkv => args.push("aac".into()),
    }
}

fn append_container_args(args: &mut Vec<String>, format: OutputFormat) {
    if format.is_quicktime_family() {
        args.push("-movflags".into());
        args.push("+faststart".into());
    }
}

/// 从 ASS 内容解析 PlayResX / PlayResY，用于设置 mov_text 字幕轨的画面尺寸。
fn parse_ass_play_res(ass: &str) -> Option<(u32, u32)> {
    let mut width: Option<u32> = None;
    let mut height: Option<u32> = None;
    for line in ass.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("PlayResX:") {
            width = rest.trim().parse().ok();
        } else if let Some(rest) = trimmed.strip_prefix("PlayResY:") {
            height = rest.trim().parse().ok();
        }
        if width.is_some() && height.is_some() {
            break;
        }
    }
    match (width, height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => Some((w, h)),
        _ => None,
    }
}

fn append_subtitle_codec_args(args: &mut Vec<String>, format: OutputFormat) {
    args.push("-c:s".into());
    args.push(
        match format {
            OutputFormat::Mp4 | OutputFormat::Mov => "mov_text",
            OutputFormat::Webm => "webvtt",
            OutputFormat::Mkv => "ass",
        }
        .into(),
    );

    // MP4/MOV：显式使用标准 tx3g（3GPP Timed Text）FourCC，
    // 保证各标准播放器（VLC / IINA / mpv 等）正确识别内嵌字幕轨。
    if matches!(format, OutputFormat::Mp4 | OutputFormat::Mov) {
        args.push("-tag:s:0".into());
        args.push("tx3g".into());
    }

    args.push("-metadata:s:s:0".into());
    args.push("language=und".into());

    // 标记为默认字幕轨，便于播放器自动启用。
    args.push("-disposition:s:0".into());
    args.push("default".into());
}

fn build_transcode_args(
    input_path: &Path,
    output_path: &Path,
    format: OutputFormat,
    quality: &str,
    preserve_audio: bool,
    h264_encoder: H264Encoder,
) -> Vec<String> {
    let mut args = vec![
        "-y".into(),
        "-i".into(),
        input_path.to_string_lossy().to_string(),
        "-map".into(),
        "0:v:0".into(),
    ];

    if preserve_audio {
        args.push("-map".into());
        args.push("0:a:0?".into());
    }

    append_video_codec_args(&mut args, format, quality, false, h264_encoder);
    append_audio_codec_args(&mut args, format, preserve_audio, false);
    append_container_args(&mut args, format);
    args.push(output_path.to_string_lossy().to_string());
    args
}

fn build_hard_subtitle_args(
    input_path: &Path,
    output_path: &Path,
    format: OutputFormat,
    quality: &str,
    preserve_audio: bool,
    video_filter: String,
    h264_encoder: H264Encoder,
) -> Vec<String> {
    let copy_audio = source_matches_output_format(input_path, format);
    let mut args = vec![
        "-y".into(),
        "-i".into(),
        input_path.to_string_lossy().to_string(),
        "-map".into(),
        "0:v:0".into(),
    ];

    if preserve_audio {
        args.push("-map".into());
        args.push("0:a:0?".into());
    }

    args.push("-vf".into());
    args.push(video_filter);
    append_video_codec_args(&mut args, format, quality, false, h264_encoder);
    append_audio_codec_args(&mut args, format, preserve_audio, copy_audio);
    append_container_args(&mut args, format);
    args.push(output_path.to_string_lossy().to_string());
    args
}

fn build_soft_subtitle_args(
    input_path: &Path,
    subtitle_path: &Path,
    output_path: &Path,
    format: OutputFormat,
    quality: &str,
    preserve_audio: bool,
    canvas_size: Option<(u32, u32)>,
    h264_encoder: H264Encoder,
) -> Vec<String> {
    let copy_media = source_matches_output_format(input_path, format);
    let mut args = vec![
        "-y".into(),
        "-i".into(),
        input_path.to_string_lossy().to_string(),
    ];

    // 给 mov_text 字幕轨写入与视频一致的画面尺寸（tkhd width/height），
    // 而非 FFmpeg 默认的 0×0，使字幕轨更符合规范（对标准播放器无副作用）。
    if matches!(format, OutputFormat::Mp4 | OutputFormat::Mov) {
        if let Some((w, h)) = canvas_size {
            args.push("-canvas_size".into());
            args.push(format!("{w}x{h}"));
        }
    }

    args.push("-i".into());
    args.push(subtitle_path.to_string_lossy().to_string());
    args.push("-map".into());
    args.push("0:v:0".into());

    if preserve_audio {
        args.push("-map".into());
        args.push("0:a:0?".into());
    }

    args.push("-map".into());
    args.push("1:s:0".into());
    append_video_codec_args(&mut args, format, quality, copy_media, h264_encoder);
    append_audio_codec_args(&mut args, format, preserve_audio, copy_media);
    append_subtitle_codec_args(&mut args, format);
    append_container_args(&mut args, format);
    args.push(output_path.to_string_lossy().to_string());
    args
}

/// 硬件编码器卡死判定：墙钟过久但输出几乎不前进（常见于录屏软件占用 VideoToolbox/NVENC）。
const HW_ENCODER_STALL_SECS: u64 = 18;
const HW_ENCODER_STALL_ERR: &str = "HARDWARE_ENCODER_STALL";

fn video_codec_from_args(args: &[String]) -> Option<&str> {
    args.iter()
        .position(|a| a == "-c:v")
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str())
}

fn is_hardware_video_codec(codec: &str) -> bool {
    matches!(
        codec,
        "h264_videotoolbox"
            | "hevc_videotoolbox"
            | "h264_nvenc"
            | "hevc_nvenc"
            | "h264_qsv"
            | "hevc_qsv"
            | "h264_amf"
            | "hevc_amf"
            | "h264_mf"
            | "hevc_mf"
    )
}

fn is_hardware_encoder_stalled(
    started: Instant,
    last_time_secs: Option<f64>,
    frame_count: Option<u64>,
) -> bool {
    if started.elapsed().as_secs() < HW_ENCODER_STALL_SECS {
        return false;
    }
    let t = last_time_secs.unwrap_or(0.0);
    let f = frame_count.unwrap_or(0);
    // 18s+ 墙钟，输出仍不足 0.5s / 8 帧 → 视为硬编被占满或假死
    t < 0.5 && f < 8
}

fn run_ffmpeg_with_options(
    app: &AppHandle,
    ffmpeg: &Path,
    args: &[String],
    stage: &str,
    progress_start: f64,
    progress_end: f64,
    message: &str,
    // 输出时间轴预估时长（裁剪后），用于正确计算进度；优先于 FFmpeg 的 input Duration
    expected_duration_secs: Option<f64>,
    extra_env: &[(String, String)],
) -> Result<(), String> {
    let cmd_preview = format_ffmpeg_command(ffmpeg, args);
    let video_codec = video_codec_from_args(args).unwrap_or("?");
    let watch_hw_stall = is_hardware_video_codec(video_codec);

    log_export(
        "ffmpeg",
        &format!(
            "start stage={stage} range={progress_start:.0}-{progress_end:.0} msg={message} expected_duration={:?} codec={video_codec} watch_hw_stall={watch_hw_stall}",
            expected_duration_secs
        ),
    );
    log_export("ffmpeg-cmd", &cmd_preview);
    if !extra_env.is_empty() {
        log_export(
            "ffmpeg-env",
            &extra_env
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(" "),
        );
    }

    log_export("ffmpeg", &format!("video_codec={video_codec}"));

    emit_progress(app, stage, progress_start, message);

    let started = Instant::now();
    let mut command = Command::new(ffmpeg);
    command.args(args).stdout(Stdio::null()).stderr(Stdio::piped());
    for (k, v) in extra_env {
        command.env(k, v);
    }
    // 避免继承可能干扰 libass 的系统 fontconfig 调试变量
    command.env_remove("FC_DEBUG");

    let mut child = command.spawn().map_err(|e| {
        let err = format!("启动 ffmpeg 失败: {e}");
        log_export("ffmpeg-error", &err);
        err
    })?;

    // 优先使用裁剪后输出时长；勿用输入片长（多段 trim 时 input Duration 会严重偏大）
    let mut duration_secs: Option<f64> = expected_duration_secs.filter(|d| *d > 0.0);
    if let Some(d) = duration_secs {
        log_export("ffmpeg", &format!("progress_duration_source=expected secs={d:.3}"));
    }
    let mut last_time_secs: Option<f64> = None;
    let mut stderr_tail: VecDeque<String> = VecDeque::with_capacity(40);
    let mut last_progress_emit = Instant::now();
    let mut last_heartbeat = Instant::now();
    let mut frame_count_hint: Option<u64> = None;
    let mut saw_any_progress = false;
    let mut text_buf = String::new();

    if let Some(stderr) = child.stderr.take() {
        // 独立线程读 stderr，主循环可做心跳（硬编卡住时 read 会阻塞）
        let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut raw_buf = [0u8; 4096];
            loop {
                match reader.read(&mut raw_buf) {
                    Ok(0) => {
                        let _ = tx.send(None);
                        break;
                    }
                    Ok(n) => {
                        if tx.send(Some(raw_buf[..n].to_vec())).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        log_export("ffmpeg-error", &format!("读取 stderr 失败: {e}"));
                        let _ = tx.send(None);
                        break;
                    }
                }
            }
        });

        loop {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(None) => break,
                Ok(Some(chunk)) => {
                    text_buf.push_str(&String::from_utf8_lossy(&chunk));
                    for line in drain_ffmpeg_stderr_lines(&mut text_buf) {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }

                        if stderr_tail.len() == 40 {
                            stderr_tail.pop_front();
                        }
                        stderr_tail.push_back(trimmed.to_string());

                        let lower = trimmed.to_ascii_lowercase();
                        if lower.contains("error")
                            || lower.contains("failed")
                            || lower.contains("invalid")
                            || lower.contains("not found")
                            || lower.contains("cannot")
                            || lower.contains("unknown")
                            || lower.contains("could not")
                            || lower.contains("not available")
                            || lower.contains("conversion failed")
                            || lower.contains("impossible")
                        {
                            log_export("ffmpeg-stderr", trimmed);
                        }

                        // 仅在没有 expected 时长时，才用 FFmpeg 报告的 Duration 兜底
                        if expected_duration_secs.is_none() && duration_secs.is_none() {
                            if let Some(raw) = extract_ffmpeg_value(trimmed, "Duration: ") {
                                if let Some(secs) = parse_ffmpeg_clock_seconds(raw) {
                                    duration_secs = Some(secs);
                                    log_export(
                                        "ffmpeg",
                                        &format!("progress_duration_source=input secs={secs:.3}"),
                                    );
                                }
                            }
                        }

                        if let Some(raw) = extract_ffmpeg_value(trimmed, "frame=") {
                            if let Ok(f) = raw.trim().parse::<u64>() {
                                frame_count_hint = Some(f);
                            }
                        }

                        if let Some(raw) = extract_ffmpeg_value(trimmed, "time=") {
                            if let Some(current_secs) = parse_ffmpeg_clock_seconds(raw) {
                                last_time_secs = Some(current_secs);
                                saw_any_progress = true;

                                // 进度严格按输出时间轴，不用墙钟“假推进”（避免 time 卡住时进度条乱走）
                                let ratio = duration_secs
                                    .filter(|duration| *duration > 0.0)
                                    .map(|duration| (current_secs / duration).clamp(0.0, 0.999))
                                    .unwrap_or(0.0);
                                let progress =
                                    lerp_progress(progress_start, progress_end, ratio);

                                if last_progress_emit.elapsed().as_millis() >= 250 {
                                    last_progress_emit = Instant::now();
                                    let fps =
                                        extract_ffmpeg_value(trimmed, "fps=").unwrap_or("?");
                                    let size = extract_ffmpeg_value(trimmed, "size=")
                                        .or_else(|| extract_ffmpeg_value(trimmed, "Lsize="))
                                        .unwrap_or("?");
                                    let detail = format!(
                                        "{message} · {current_secs:.1}s · fps={fps} · size={size}"
                                    );
                                    emit_progress(app, stage, progress, &detail);
                                    log_export(
                                        "ffmpeg-progress",
                                        &format!(
                                            "time={current_secs:.2}s ratio={ratio:.3} progress={progress:.1} fps={fps} size={size}"
                                        ),
                                    );
                                }
                            }
                        }

                        if trimmed.starts_with("Stream mapping:")
                            || trimmed.contains("encoder")
                            || trimmed.starts_with("Output #")
                            || trimmed.starts_with("Input #")
                            || trimmed.contains("Press [q]")
                            || trimmed.contains("hwaccel")
                            || trimmed.contains("videotoolbox")
                            || trimmed.contains("nvenc")
                            || trimmed.contains("qsv")
                            || trimmed.contains("amf")
                        {
                            log_export("ffmpeg-info", trimmed);
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // fall through to heartbeat below
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            if last_heartbeat.elapsed().as_secs() >= 3 {
                last_heartbeat = Instant::now();
                let elapsed = started.elapsed().as_secs();
                if !saw_any_progress {
                    let tip = if watch_hw_stall && elapsed >= 8 {
                        format!(
                            "{message} · 启动中… {elapsed}s（硬件编码可能被录屏软件占用）"
                        )
                    } else {
                        format!("{message} · 启动中… {elapsed}s（等待编码器/首帧）")
                    };
                    let boot_progress = lerp_progress(
                        progress_start,
                        progress_start + (progress_end - progress_start) * 0.08,
                        (elapsed as f64 / 60.0).clamp(0.0, 1.0),
                    );
                    emit_progress(app, stage, boot_progress, &tip);
                    log_export(
                        "ffmpeg-heartbeat",
                        &format!(
                            "no time= yet elapsed={elapsed}s frames={:?} duration={:?} last_stderr={}",
                            frame_count_hint,
                            duration_secs,
                            stderr_tail.back().map(|s| s.as_str()).unwrap_or("(none)")
                        ),
                    );
                } else if let Some(t) = last_time_secs {
                    log_export(
                        "ffmpeg-heartbeat",
                        &format!(
                            "alive elapsed={elapsed}s last_time={t:.2}s frames={:?}",
                            frame_count_hint
                        ),
                    );
                }
            }

            // 硬件编码假死：杀进程并让上层回落 libx264（避免与 DemoGet 等录屏软件抢 VideoToolbox 时卡死数分钟）
            if watch_hw_stall
                && is_hardware_encoder_stalled(started, last_time_secs, frame_count_hint)
            {
                log_export(
                    "ffmpeg-stall",
                    &format!(
                        "hardware encoder stall codec={video_codec} elapsed={}s last_time={:?}s frames={:?} — likely contended by screen recorder / another HW encoder",
                        started.elapsed().as_secs(),
                        last_time_secs,
                        frame_count_hint
                    ),
                );
                emit_progress(
                    app,
                    stage,
                    progress_start,
                    "硬件编码无响应（可能被录屏软件占用），准备改用软件编码…",
                );
                let _ = child.kill();
                let _ = child.wait();
                // 排空剩余 stderr，避免写半截管道
                while let Ok(Some(_)) = rx.try_recv() {}
                return Err(HW_ENCODER_STALL_ERR.to_string());
            }
        }

        if !text_buf.trim().is_empty() {
            let tail = text_buf.trim().to_string();
            stderr_tail.push_back(tail.clone());
            log_export("ffmpeg-stderr-tail", &tail);
        }
    }

    // 若 stderr 已结束但进程仍在，再做一次 stall 检查（极端情况）
    if watch_hw_stall
        && is_hardware_encoder_stalled(started, last_time_secs, frame_count_hint)
    {
        log_export("ffmpeg-stall", "stall detected after stderr EOF");
        let _ = child.kill();
        let _ = child.wait();
        return Err(HW_ENCODER_STALL_ERR.to_string());
    }

    let status = child.wait().map_err(|e| {
        let err = format!("等待 ffmpeg 失败: {e}");
        log_export("ffmpeg-error", &err);
        err
    })?;

    let elapsed = started.elapsed().as_secs_f64();
    if status.success() {
        log_export(
            "ffmpeg",
            &format!(
                "ok stage={stage} elapsed={elapsed:.2}s last_time={:?}s frames={:?}",
                last_time_secs, frame_count_hint
            ),
        );
        emit_progress(app, stage, progress_end, message);
        Ok(())
    } else {
        let details = stderr_tail.into_iter().collect::<Vec<_>>().join("\n");
        log_export(
            "ffmpeg-error",
            &format!(
                "fail stage={stage} exit={status} elapsed={elapsed:.2}s\n{details}"
            ),
        );
        if details.trim().is_empty() {
            Err(format!(
                "ffmpeg 命令失败 (exit={status}, stage={stage}, elapsed={elapsed:.1}s)"
            ))
        } else {
            Err(format!(
                "ffmpeg 命令失败 (exit={status}, stage={stage}, elapsed={elapsed:.1}s):\n{details}"
            ))
        }
    }
}

/// 硬件编码优先；失败时清理输出并回落 libx264 重试一次。
fn run_ffmpeg_with_h264_fallback<F>(
    app: &AppHandle,
    ffmpeg: &Path,
    preferred: H264Encoder,
    output_path: &Path,
    stage: &str,
    progress_start: f64,
    progress_end: f64,
    base_message: &str,
    needs_h264_encode: bool,
    expected_duration_secs: Option<f64>,
    extra_env: &[(String, String)],
    mut build_args: F,
) -> Result<(), String>
where
    F: FnMut(H264Encoder) -> Vec<String>,
{
    // WebM/VP9 或 stream copy 路径不走 H.264 回落链
    if !needs_h264_encode {
        let args = build_args(preferred);
        return run_ffmpeg_with_options(
            app,
            ffmpeg,
            &args,
            stage,
            progress_start,
            progress_end,
            base_message,
            expected_duration_secs,
            extra_env,
        );
    }

    let attempts: Vec<H264Encoder> = if preferred.is_hardware() {
        vec![preferred, H264Encoder::Libx264]
    } else {
        vec![H264Encoder::Libx264]
    };

    let mut last_err = String::new();
    for (idx, encoder) in attempts.into_iter().enumerate() {
        if idx > 0 {
            let _ = std::fs::remove_file(output_path);
            let stall = last_err == HW_ENCODER_STALL_ERR;
            let tip = if stall {
                format!(
                    "{} 被占用/无响应（常见：录屏软件），改用 {}…",
                    preferred.display_name(),
                    encoder.display_name()
                )
            } else {
                format!(
                    "{} 失败，回退 {}...",
                    preferred.display_name(),
                    encoder.display_name()
                )
            };
            emit_progress(app, stage, progress_start, &tip);
            log_export("ffmpeg-fallback", &tip);
        }

        let message = if encoder.is_hardware() {
            format!("{}（{}）", base_message, encoder.display_name())
        } else if preferred.is_hardware() && idx > 0 {
            format!("{}（软件编码 · 关闭录屏可加速）", base_message)
        } else {
            base_message.to_string()
        };

        let args = build_args(encoder);
        match run_ffmpeg_with_options(
            app,
            ffmpeg,
            &args,
            stage,
            progress_start,
            progress_end,
            &message,
            expected_duration_secs,
            extra_env,
        ) {
            Ok(()) => return Ok(()),
            Err(err) => {
                // 非硬件路径的 stall 标记不应出现；硬件失败则继续尝试 libx264
                last_err = err;
                if encoder == H264Encoder::Libx264 {
                    break;
                }
            }
        }
    }

    if last_err == HW_ENCODER_STALL_ERR {
        Err(
            "硬件编码长时间无响应（可能被 DemoGet 等录屏软件占用 VideoToolbox）。已尝试软件编码仍失败，请暂时停止录屏后重试。"
                .into(),
        )
    } else {
        Err(last_err)
    }
}

/// 构建 select/aselect 表达式：单次顺序读输入，避免 N 路 trim 并行消费同一 [0:v] 导致卡死/极慢。
/// 逗号在 filtergraph 中需转义为 `\,`。
fn build_select_expr(kept: &[VideoSegmentInput]) -> Result<String, String> {
    if kept.is_empty() {
        return Err("没有要保留的视频片段".into());
    }
    let expr = kept
        .iter()
        .map(|seg| {
            // between(t,start,end) 闭区间，与 trim 行为接近
            format!("between(t\\,{:.6}\\,{:.6})", seg.start, seg.end)
        })
        .collect::<Vec<_>>()
        .join("+");
    Ok(expr)
}

/// 裁剪滤镜：select 丢弃删除段 + setpts 压成连续时间轴。
/// 返回 (filter_complex, 视频标签, 可选音频标签)。
fn build_kept_segments_filter(
    kept: &[VideoSegmentInput],
    preserve_audio: bool,
) -> Result<(String, String, Option<String>), String> {
    let sel = build_select_expr(kept)?;
    // N/FRAME_RATE/TB：按输出帧序号重建时间戳，避免 select 后 PTS 空洞
    let mut filter = format!("[0:v]select='{sel}',setpts=N/FRAME_RATE/TB[vsel];");
    let audio_label = if preserve_audio {
        filter.push_str(&format!(
            "[0:a]aselect='{sel}',asetpts=N/SR/TB[asel];"
        ));
        Some("asel".to_string())
    } else {
        None
    };
    Ok((filter, "vsel".to_string(), audio_label))
}

fn build_cut_args(
    input_path: &str,
    output_path: &Path,
    kept: &[VideoSegmentInput],
    preserve_audio: bool,
    quality: &str,
    h264_encoder: H264Encoder,
) -> Result<Vec<String>, String> {
    let mut args = vec!["-y".to_string()];

    if kept.len() == 1 {
        // 单段：-ss 放 input 前可加速 seek
        let seg = &kept[0];
        args.push("-ss".into());
        args.push(seg.start.to_string());
        args.push("-i".into());
        args.push(input_path.into());
        args.push("-t".into());
        args.push((seg.end - seg.start).to_string());
    } else {
        args.push("-i".into());
        args.push(input_path.into());

        let (filter, v_label, a_label) = build_kept_segments_filter(kept, preserve_audio)?;
        let filter = filter.trim_end_matches(';').to_string();

        args.push("-filter_complex".into());
        args.push(filter);
        args.push("-map".into());
        args.push(format!("[{v_label}]"));
        if let Some(a_label) = a_label {
            args.push("-map".into());
            args.push(format!("[{a_label}]"));
        }
    }

    // 中间裁剪文件固定为 H.264/AAC MP4（优先硬件编码）
    append_h264_encoder_args(&mut args, h264_encoder, quality);

    if preserve_audio {
        args.push("-c:a".into());
        args.push("aac".into());
    } else {
        args.push("-an".into());
    }

    args.push(output_path.to_string_lossy().to_string());
    Ok(args)
}


fn process_video_blocking(
    app: AppHandle,
    options: ProcessVideoOptions,
) -> Result<ProcessVideoResult, String> {
    let export_started = Instant::now();
    log_export(
        "export",
        &format!(
            "begin input={} format={} quality={} preserve_audio={} subtitle={} segments={} output={:?}",
            options.input_path,
            options.output_format,
            options.quality,
            options.preserve_audio,
            options.subtitle_processing,
            options.segments.len(),
            options.output_path,
        ),
    );

    let resolved = ffmpeg_bin::resolve_ffmpeg(Some(&app))?;
    let version = ffmpeg_bin::verify_ffmpeg(&resolved.path)?;
    log_export(
        "export",
        &format!(
            "ffmpeg path={} source={:?} version={}",
            resolved.path.display(),
            resolved.source,
            version
        ),
    );

    let input = PathBuf::from(&options.input_path);
    if !input.is_file() {
        let err = format!("输入视频不存在: {}", options.input_path);
        log_export("export-error", &err);
        return Err(err);
    }
    if let Ok(meta) = std::fs::metadata(&input) {
        log_export(
            "export",
            &format!("input_size_bytes={}", meta.len()),
        );
    }

    // 合并相邻 keep/delete 片段，降低 filter 复杂度
    let merged_segments = merge_adjacent_segments(&options.segments);
    let kept: Vec<VideoSegmentInput> = merged_segments
        .iter()
        .filter(|s| s.keep)
        .cloned()
        .collect();
    if kept.is_empty() {
        let err = "没有要保留的视频片段".to_string();
        log_export("export-error", &err);
        return Err(err);
    }

    let deleted_count = merged_segments.iter().filter(|s| !s.keep).count();
    let kept_duration: f64 = kept.iter().map(|s| (s.end - s.start).max(0.0)).sum();
    log_export(
        "export",
        &format!(
            "segments raw={} merged={} kept={} deleted={} kept_duration={kept_duration:.2}s",
            options.segments.len(),
            merged_segments.len(),
            kept.len(),
            deleted_count,
        ),
    );
    for (i, seg) in kept.iter().enumerate().take(12) {
        log_export(
            "export-kept",
            &format!("[{i}] {:.3}-{:.3} ({:.3}s)", seg.start, seg.end, seg.end - seg.start),
        );
    }
    if kept.len() > 12 {
        log_export(
            "export-kept",
            &format!("... and {} more kept segments", kept.len() - 12),
        );
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

    let output_format = OutputFormat::parse(&options.output_format)?;
    let cut_path = work_dir.join(format!("cut_{ts}.mp4"));
    let ass_path = work_dir.join(format!("subs_{ts}.ass"));
    let vtt_path = work_dir.join(format!("subs_{ts}.vtt"));
    let output_path = if let Some(custom) = options.output_path.as_ref() {
        let path = PathBuf::from(custom);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {e}"))?;
        }
        path
    } else {
        work_dir.join(format!("output_{ts}.{}", output_format.extension()))
    };

    let has_deletions = has_deleted_segments(&merged_segments);
    let has_ass = options.ass_content.as_ref().is_some_and(|s| !s.trim().is_empty());
    let is_hard = options.subtitle_processing == "hard" && has_ass;
    let is_soft = options.subtitle_processing == "soft" && has_ass;

    let preferred_h264 = select_h264_encoder(&resolved.path);
    let available_encoders = list_ffmpeg_encoders(&resolved.path);
    log_export(
        "export",
        &format!(
            "encoder preferred={} ({}) hardware={} available={:?}",
            preferred_h264.codec_name(),
            preferred_h264.display_name(),
            preferred_h264.is_hardware(),
            {
                let mut names: Vec<_> = available_encoders.into_iter().collect();
                names.sort();
                names
            }
        ),
    );
    let h264_output = matches!(
        output_format,
        OutputFormat::Mp4 | OutputFormat::Mov | OutputFormat::Mkv
    );
    log_export(
        "export",
        &format!(
            "route has_deletions={has_deletions} is_hard={is_hard} is_soft={is_soft} h264_output={h264_output} work_dir={}",
            work_dir.display()
        ),
    );

    if preferred_h264.is_hardware() {
        emit_progress(
            &app,
            "analyzing",
            5.0,
            &format!("使用硬件编码：{}", preferred_h264.display_name()),
        );
    }

    // 输出时间轴预估（裁剪后总时长），供进度条使用
    let expected_output_duration = Some(kept_duration);

    // ---------- 硬烧录 ----------
    // 裁剪+硬烧拆成两步（先 select 裁剪，再 -vf ass 烧录）：
    // 单 filter 里 select+aselect+ass 在双语副字幕（BorderStyle 底框/双 layer）场景下会掉到 <1fps。
    // 两步各跑高速路径，总时间仍远快于卡死的单 pass。
    if is_hard {
        let raw_ass = options.ass_content.as_ref().unwrap();
        let ass_content = normalize_ass_for_hard_burn(raw_ass);
        let dialogue_count = ass_content.lines().filter(|l| l.starts_with("Dialogue:")).count();
        let has_secondary_style = ass_content.lines().any(|l| l.starts_with("Style: Secondary"));
        let secondary_events = ass_content
            .lines()
            .filter(|l| l.starts_with("Dialogue:") && l.contains(",Secondary,"))
            .count();
        log_export(
            "export",
            &format!(
                "ass optimized fonts_dir={:?} ass_bytes={} dialogues={} has_secondary_style={} secondary_events={}",
                fonts_dir,
                ass_content.len(),
                dialogue_count,
                has_secondary_style,
                secondary_events,
            ),
        );
        if has_secondary_style || secondary_events > 0 {
            log_export(
                "export",
                "bilingual hard-burn: dual-layer ASS; cut+burn split into 2 passes for speed",
            );
        }
        std::fs::write(&ass_path, &ass_content).map_err(|e| format!("写入 ASS 字幕失败: {e}"))?;
        let ass_filter = build_ass_video_filter(&ass_path, fonts_dir.as_deref());

        // 不再强制 FONTCONFIG_FILE 隔离：fontsdir= 已足够；隔离配置在部分环境下会拖慢 libass 选字
        let burn_env: Vec<(String, String)> = Vec::new();
        if fonts_dir.is_none() {
            log_export(
                "export-warn",
                "未找到内置 subtitle-fonts，硬烧录可能回退系统字体并变慢",
            );
        }

        let burn_source = if has_deletions {
            log_export("export", "hard-burn step1=cut (select, no ass)");
            run_ffmpeg_with_h264_fallback(
                &app,
                &resolved.path,
                preferred_h264,
                &cut_path,
                "cutting",
                10.0,
                52.0,
                "裁剪视频片段",
                true,
                expected_output_duration,
                &[],
                |encoder| {
                    build_cut_args(
                        &options.input_path,
                        &cut_path,
                        &kept,
                        options.preserve_audio,
                        &options.quality,
                        encoder,
                    )
                    .expect("kept segments non-empty")
                },
            )?;
            cut_path.clone()
        } else {
            input.clone()
        };

        log_export(
            "export",
            &format!(
                "hard-burn step2=ass burn source={}",
                burn_source.display()
            ),
        );
        run_ffmpeg_with_h264_fallback(
            &app,
            &resolved.path,
            preferred_h264,
            &output_path,
            "encoding",
            if has_deletions { 55.0 } else { 20.0 },
            95.0,
            if has_deletions {
                "硬烧录字幕"
            } else {
                "硬烧录字幕"
            },
            h264_output,
            expected_output_duration,
            &burn_env,
            |encoder| {
                build_hard_subtitle_args(
                    &burn_source,
                    &output_path,
                    output_format,
                    &options.quality,
                    options.preserve_audio,
                    ass_filter.clone(),
                    encoder,
                )
            },
        )?;

        if has_deletions && cut_path.exists() {
            let _ = std::fs::remove_file(&cut_path);
        }
        let _ = std::fs::remove_file(&ass_path);
        emit_progress(&app, "complete", 100.0, "视频导出完成");
        log_export_success(
            &output_path,
            export_started,
            if has_deletions {
                "hard-burn-2pass"
            } else {
                "hard-burn"
            },
        );
        return Ok(ProcessVideoResult {
            output_path: output_path.to_string_lossy().to_string(),
        });
    }

    // ---------- 无硬烧：按需裁剪，再软字幕/格式转换/直通 ----------
    let video_source = if has_deletions {
        // 中间裁剪产物始终为 H.264 MP4，可走硬件编码
        log_export("export", "step=cutting start");
        run_ffmpeg_with_h264_fallback(
            &app,
            &resolved.path,
            preferred_h264,
            &cut_path,
            "cutting",
            15.0,
            55.0,
            "裁剪并拼接视频",
            true,
            expected_output_duration,
            &[],
            |encoder| {
                build_cut_args(
                    &options.input_path,
                    &cut_path,
                    &kept,
                    options.preserve_audio,
                    &options.quality,
                    encoder,
                )
                .expect("kept segments non-empty")
            },
        )?;
        cut_path.clone()
    } else {
        emit_progress(&app, "analyzing", 15.0, "未检测到删除片段，跳过裁剪重编码");
        input.clone()
    };

    if is_soft {
        let ass_content = options.ass_content.as_ref().unwrap();
        let subtitle_canvas_size = parse_ass_play_res(ass_content);
        std::fs::write(&ass_path, ass_content).map_err(|e| format!("写入 ASS 字幕失败: {e}"))?;

        // MP4/MOV 必须用 ASS 作为中间格式：VTT→mov_text 时 FFmpeg 默认 Arial，QuickTime 无法渲染中文。
        // WebM 使用 webvtt 编码，继续走 VTT；MKV 保留 ASS 样式轨。
        let subtitle_path = if matches!(output_format, OutputFormat::Webm) {
            match options.subtitle_text_content.as_deref() {
                Some(content) if !content.trim().is_empty() => {
                    std::fs::write(&vtt_path, content)
                        .map_err(|e| format!("写入 VTT 字幕失败: {e}"))?;
                    vtt_path.clone()
                }
                _ => ass_path.clone(),
            }
        } else {
            ass_path.clone()
        };

        // 格式匹配时可 stream copy，无需重编码
        let needs_reencode = !source_matches_output_format(&video_source, output_format);
        run_ffmpeg_with_h264_fallback(
            &app,
            &resolved.path,
            preferred_h264,
            &output_path,
            "encoding",
            65.0,
            95.0,
            "嵌入字幕轨道",
            needs_reencode && h264_output,
            expected_output_duration,
            &[],
            |encoder| {
                build_soft_subtitle_args(
                    &video_source,
                    &subtitle_path,
                    &output_path,
                    output_format,
                    &options.quality,
                    options.preserve_audio,
                    subtitle_canvas_size,
                    encoder,
                )
            },
        )?;

        if has_deletions && cut_path.exists() {
            let _ = std::fs::remove_file(&cut_path);
        }
        let _ = std::fs::remove_file(&ass_path);
        let _ = std::fs::remove_file(&vtt_path);

        emit_progress(&app, "complete", 100.0, "视频导出完成");
        log_export_success(&output_path, export_started, "soft-subtitle");
        return Ok(ProcessVideoResult {
            output_path: output_path.to_string_lossy().to_string(),
        });
    }

    // 无字幕：格式匹配则直通，否则转码
    if source_matches_output_format(&video_source, output_format) {
        log_export(
            "export",
            &format!(
                "step=copy_or_rename has_deletions={has_deletions} src={}",
                video_source.display()
            ),
        );
        if has_deletions {
            std::fs::rename(&video_source, &output_path)
                .or_else(|_| {
                    std::fs::copy(&video_source, &output_path)?;
                    std::fs::remove_file(&video_source)?;
                    Ok::<(), std::io::Error>(())
                })
                .map_err(|e| format!("保存输出失败: {e}"))?;
        } else {
            copy_file_to_output(&video_source, &output_path)?;
        }
    } else {
        run_ffmpeg_with_h264_fallback(
            &app,
            &resolved.path,
            preferred_h264,
            &output_path,
            "encoding",
            65.0,
            95.0,
            "转换输出格式",
            h264_output,
            expected_output_duration,
            &[],
            |encoder| {
                build_transcode_args(
                    &video_source,
                    &output_path,
                    output_format,
                    &options.quality,
                    options.preserve_audio,
                    encoder,
                )
            },
        )?;
        if has_deletions && cut_path.exists() {
            let _ = std::fs::remove_file(&cut_path);
        }
    }

    emit_progress(&app, "complete", 100.0, "视频导出完成");
    log_export_success(&output_path, export_started, "cut-or-copy");
    Ok(ProcessVideoResult {
        output_path: output_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn check_ffmpeg_environment(app: AppHandle) -> Result<serde_json::Value, String> {
    match ffmpeg_bin::resolve_ffmpeg(Some(&app)) {
        Ok(ResolvedFfmpeg { path, source }) => match ffmpeg_bin::verify_ffmpeg(&path) {
            Ok(version) => {
                let encoder = select_h264_encoder(&path);
                Ok(serde_json::json!({
                    "available": true,
                    "source": match source {
                        FfmpegSource::Bundled => "bundled",
                        FfmpegSource::System => "system",
                    },
                    "path": path.display().to_string(),
                    "version": version,
                    "videoEncoder": encoder.codec_name(),
                    "videoEncoderLabel": encoder.display_name(),
                    "hardwareEncoding": encoder.is_hardware(),
                }))
            }
            Err(error) => Ok(serde_json::json!({
                "available": false,
                "error": error,
            })),
        },
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
    let result = tauri::async_runtime::spawn_blocking(move || process_video_blocking(app, options))
        .await
        .map_err(|e| format!("视频处理任务异常: {e}"))?;
    match &result {
        Ok(ok) => log_export("export", &format!("command ok output={}", ok.output_path)),
        Err(err) => log_export("export-error", &format!("command failed: {err}")),
    }
    result
}
