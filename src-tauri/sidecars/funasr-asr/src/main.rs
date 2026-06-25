use sherpa_onnx::{
    OfflineParaformerModelConfig, OfflineRecognizer, OfflineRecognizerConfig,
    OfflineSenseVoiceModelConfig, Wave,
};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{self, Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
struct Args {
    input: PathBuf,
    model: PathBuf,
    language: String,
    output_json: bool,
}

struct RecognitionOutput {
    text: String,
    duration: f64,
    chunks: Vec<SubtitleChunk>,
}

struct SubtitleChunk {
    text: String,
    start: f64,
    end: f64,
}

fn main() {
    match run() {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("{error}");
            process::exit(1);
        }
    }
}

fn run() -> Result<String, String> {
    let args = parse_args(env::args().skip(1))?;
    validate_args(&args)?;

    if !args.output_json {
        return Err("必须指定 --output-json".to_string());
    }

    let audio_path = prepare_wav_input(&args.input)?;
    let recognition = recognize(&args, &audio_path);

    if audio_path != args.input {
        let _ = fs::remove_file(&audio_path);
    }

    let recognition = recognition?;
    let text = escape_json_string(&recognition.text);
    let chunks_json = recognition
        .chunks
        .iter()
        .enumerate()
        .map(|(index, chunk)| {
            format!(
                "{{\"id\":\"chunk-{}\",\"text\":\"{}\",\"timestamp\":[{:.3},{:.3}],\"selected\":false}}",
                index + 1,
                escape_json_string(&chunk.text),
                chunk.start,
                chunk.end
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    Ok(format!(
        "{{\"text\":\"{}\",\"chunks\":[{}],\"language\":\"{}\",\"duration\":{:.3}}}",
        text,
        chunks_json,
        escape_json_string(&args.language),
        recognition.duration
    ))
}

fn recognize(args: &Args, wav_path: &Path) -> Result<RecognitionOutput, String> {
    let wav_path_str = wav_path
        .to_str()
        .ok_or_else(|| format!("音频路径包含非法字符：{}", wav_path.display()))?;
    let wave = Wave::read(wav_path_str)
        .ok_or_else(|| format!("无法读取 WAV 音频：{}", wav_path.display()))?;

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.tokens = Some(args.model.join("tokens.txt").to_string_lossy().to_string());
    config.model_config.num_threads = 2;
    config.model_config.provider = Some("cpu".to_string());

    let model_path = args.model.join("model.int8.onnx").to_string_lossy().to_string();
    if is_paraformer_model(&args.model) {
        config.model_config.paraformer = OfflineParaformerModelConfig {
            model: Some(model_path),
        };
        config.model_config.model_type = Some("paraformer".to_string());
    } else {
        config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
            model: Some(model_path),
            language: Some(normalize_sense_voice_language(&args.language)),
            use_itn: true,
        };
    }

    let recognizer = OfflineRecognizer::create(&config)
        .ok_or_else(|| "创建 sherpa-onnx OfflineRecognizer 失败，请确认模型文件与模型类型匹配".to_string())?;
    let stream = recognizer.create_stream();
    stream.accept_waveform(wave.sample_rate(), wave.samples());
    recognizer.decode(&stream);

    let result = stream
        .get_result()
        .ok_or_else(|| "sherpa-onnx 未返回识别结果".to_string())?;
    let text = result.text.trim().to_string();
    if text.is_empty() {
        return Err("未识别到字幕文本，请确认视频包含清晰人声或尝试更换模型".to_string());
    }

    let duration = if wave.sample_rate() > 0 {
        wave.samples().len() as f64 / wave.sample_rate() as f64
    } else {
        0.0
    };
    let chunks = split_text_to_chunks(&text, duration);

    Ok(RecognitionOutput {
        text,
        duration,
        chunks,
    })
}

fn split_text_to_chunks(text: &str, duration: f64) -> Vec<SubtitleChunk> {
    let mut pieces = Vec::new();
    let mut current = String::new();
    let max_chars = 28;

    for ch in text.chars() {
        current.push(ch);
        let should_split = matches!(ch, '。' | '！' | '？' | '，' | ',' | '.' | '!' | '?')
            || current.chars().count() >= max_chars;
        if should_split {
            push_subtitle_piece(&mut pieces, &mut current);
        }
    }

    push_subtitle_piece(&mut pieces, &mut current);

    if pieces.is_empty() {
        pieces.push(text.to_string());
    }

    let total_chars = pieces
        .iter()
        .map(|piece| piece.chars().count().max(1))
        .sum::<usize>() as f64;
    let mut cursor = 0.0;

    pieces
        .into_iter()
        .map(|piece| {
            let ratio = piece.chars().count().max(1) as f64 / total_chars;
            let mut end = cursor + duration.max(0.1) * ratio;
            if end <= cursor {
                end = cursor + 0.1;
            }
            let chunk = SubtitleChunk {
                text: piece,
                start: cursor,
                end,
            };
            cursor = end;
            chunk
        })
        .collect()
}

fn push_subtitle_piece(pieces: &mut Vec<String>, current: &mut String) {
    let piece = current.trim();
    if piece.is_empty() {
        current.clear();
        return;
    }

    let is_only_punctuation = piece.chars().all(|ch| ch.is_ascii_punctuation() || "，。！？、；：".contains(ch));
    let is_too_short = piece.chars().count() <= 2;

    if (is_only_punctuation || is_too_short) && !pieces.is_empty() {
        if let Some(last) = pieces.last_mut() {
            last.push_str(piece);
        }
    } else {
        pieces.push(piece.to_string());
    }

    current.clear();
}

fn prepare_wav_input(input: &Path) -> Result<PathBuf, String> {
    let ext = input
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "wav" {
        return Ok(input.to_path_buf());
    }

    let output = env::temp_dir().join(format!(
        "flycut-funasr-{}-{}.wav",
        process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));

    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-i")
        .arg(input)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-f")
        .arg("wav")
        .arg(&output)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("调用 ffmpeg 失败：{e}。请先安装 ffmpeg，或上传 16k 单声道 WAV 文件。"))?;

    if !status.success() {
        return Err(format!(
            "ffmpeg 提取音频失败：{}。请确认媒体文件包含音频轨道。",
            input.display()
        ));
    }

    Ok(output)
}

fn is_paraformer_model(model_dir: &Path) -> bool {
    model_dir
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_lowercase().contains("paraformer"))
        .unwrap_or(false)
}

fn normalize_sense_voice_language(language: &str) -> String {
    match language.to_lowercase().as_str() {
        "zh" | "zh-cn" | "chinese" => "zh".to_string(),
        "en" | "english" => "en".to_string(),
        "ja" | "jp" | "japanese" => "ja".to_string(),
        "ko" | "kr" | "korean" => "ko".to_string(),
        "yue" | "cantonese" => "yue".to_string(),
        "auto" => "auto".to_string(),
        _ => "auto".to_string(),
    }
}

fn parse_args(mut args: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut input = None;
    let mut model = None;
    let mut language = "zh".to_string();
    let mut output_json = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--input" => input = Some(read_value("--input", &mut args)?),
            "--model" => model = Some(read_value("--model", &mut args)?),
            "--language" => language = read_value("--language", &mut args)?,
            "--output-json" => output_json = true,
            "--help" | "-h" => return Err(usage()),
            unknown => return Err(format!("未知参数：{unknown}\n{}", usage())),
        }
    }

    Ok(Args {
        input: input
            .map(PathBuf::from)
            .ok_or_else(|| format!("缺少 --input\n{}", usage()))?,
        model: model
            .map(PathBuf::from)
            .ok_or_else(|| format!("缺少 --model\n{}", usage()))?,
        language,
        output_json,
    })
}

fn read_value(
    name: &str,
    args: &mut impl Iterator<Item = String>,
) -> Result<String, String> {
    args.next()
        .filter(|value| !value.starts_with("--"))
        .ok_or_else(|| format!("{name} 缺少参数值"))
}

fn validate_args(args: &Args) -> Result<(), String> {
    if !args.input.is_file() {
        return Err(format!("输入文件不存在或不是文件：{}", args.input.display()));
    }

    if !args.model.is_dir() {
        return Err(format!("模型目录不存在或不是目录：{}", args.model.display()));
    }

    for file in ["model.int8.onnx", "tokens.txt"] {
        let path = args.model.join(file);
        if !path.is_file() {
            return Err(format!("模型目录缺少必要文件：{}", path.display()));
        }
    }

    Ok(())
}

fn escape_json_string(input: &str) -> String {
    let mut escaped = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            ch if ch.is_control() => escaped.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => escaped.push(ch),
        }
    }
    escaped
}

fn usage() -> String {
    "用法：funasr-asr --input <media-file> --model <model-dir> [--language zh] --output-json".to_string()
}
