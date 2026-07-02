use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
pub struct FrontendConf {
    pub fs: i32,
    pub window: String,
    pub n_mels: usize,
    pub frame_length: i32,
    pub frame_shift: i32,
    pub dither: f32,
    pub lfr_m: usize,
    pub lfr_n: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EncoderConf {
    pub fsmn_layers: usize,
    pub proj_dim: usize,
    pub lorder: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VadPostConf {
    pub sample_rate: i32,
    pub detect_mode: i32,
    pub snr_mode: i32,
    pub max_end_silence_time: i32,
    pub max_start_silence_time: i32,
    pub do_start_point_detection: bool,
    pub do_end_point_detection: bool,
    pub window_size_ms: i32,
    pub sil_to_speech_time_thres: i32,
    pub speech_to_sil_time_thres: i32,
    pub speech_2_noise_ratio: f64,
    pub do_extend: i32,
    pub lookback_time_start_point: i32,
    pub lookahead_time_end_point: i32,
    pub max_single_segment_time: i32,
    pub snr_thres: f64,
    pub noise_frame_num_used_for_snr: i32,
    pub decibel_thres: f64,
    pub speech_noise_thres: f64,
    pub fe_prior_thres: f64,
    pub silence_pdf_num: i32,
    pub sil_pdf_ids: Vec<usize>,
    pub speech_noise_thresh_low: f64,
    pub speech_noise_thresh_high: f64,
    pub output_frame_probs: bool,
    pub frame_in_ms: i32,
    pub frame_length_ms: i32,
}

#[derive(Debug, Clone, Deserialize)]
struct VadYaml {
    frontend_conf: FrontendConf,
    encoder_conf: EncoderConf,
    vad_post_conf: VadPostConf,
}

#[derive(Debug, Clone)]
pub struct CmvnStats {
    pub means: Vec<f32>,
    pub vars: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct FsmnVadConfig {
    pub model_path: PathBuf,
    pub frontend: FrontendConf,
    pub encoder: EncoderConf,
    pub vad_post: VadPostConf,
    pub cmvn: CmvnStats,
}

pub fn load_config(model_dir: &Path) -> Result<FsmnVadConfig, String> {
    let config_path = if model_dir.join("config.yaml").is_file() {
        model_dir.join("config.yaml")
    } else {
        model_dir.join("vad.yaml")
    };

    let yaml_text = fs::read_to_string(&config_path)
        .map_err(|e| format!("读取 VAD 配置失败：{} ({e})", config_path.display()))?;
    let parsed: VadYaml = serde_yaml::from_str(&yaml_text)
        .map_err(|e| format!("解析 VAD 配置失败：{} ({e})", config_path.display()))?;

    let cmvn_path = if model_dir.join("am.mvn").is_file() {
        model_dir.join("am.mvn")
    } else {
        model_dir.join("vad.mvn")
    };
    let cmvn = load_cmvn(&cmvn_path)?;

    // tract-onnx 对 quant MatMul 支持不完整，优先使用全精度 model.onnx
    let model_path = if model_dir.join("model.onnx").is_file() {
        model_dir.join("model.onnx")
    } else {
        model_dir.join("model_quant.onnx")
    };

    Ok(FsmnVadConfig {
        model_path,
        frontend: parsed.frontend_conf,
        encoder: parsed.encoder_conf,
        vad_post: parsed.vad_post_conf,
        cmvn,
    })
}

pub fn load_cmvn(path: &Path) -> Result<CmvnStats, String> {
    let text = fs::read_to_string(path)
        .map_err(|e| format!("读取 CMVN 失败：{} ({e})", path.display()))?;
    let lines: Vec<&str> = text.lines().collect();

    let mut means = Vec::new();
    let mut vars = Vec::new();

    let mut i = 0;
    while i < lines.len() {
        let parts: Vec<&str> = lines[i].split_whitespace().collect();
        if parts.first() == Some(&"<AddShift>") {
            let next: Vec<&str> = lines.get(i + 1).unwrap_or(&"").split_whitespace().collect();
            if next.first() == Some(&"<LearnRateCoef>") && next.len() > 3 {
                means = next[3..next.len() - 1]
                    .iter()
                    .map(|v| v.parse::<f32>().unwrap_or(0.0))
                    .collect();
            }
        } else if parts.first() == Some(&"<Rescale>") {
            let next: Vec<&str> = lines.get(i + 1).unwrap_or(&"").split_whitespace().collect();
            if next.first() == Some(&"<LearnRateCoef>") && next.len() > 3 {
                vars = next[3..next.len() - 1]
                    .iter()
                    .map(|v| v.parse::<f32>().unwrap_or(1.0))
                    .collect();
            }
        }
        i += 1;
    }

    if means.is_empty() || vars.is_empty() {
        return Err(format!("CMVN 文件格式无效：{}", path.display()));
    }

    Ok(CmvnStats { means, vars })
}