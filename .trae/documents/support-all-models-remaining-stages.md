# 支持 models.json 全部模型：剩余阶段实施计划

## Summary

本计划是 `.trae/documents/support-all-models-in-models-json.md` 的续作，专注完成尚未实现的三个阶段。前序会话已完成 **阶段 1（manifest 加载）、阶段 2（归档下载+解压、shared_assets）、阶段 3.1（sidecar Cargo.toml 启用 vad）**，本计划覆盖剩余的：

- **阶段 3.2**：重写 `src-tauri/sidecars/funasr-asr/src/main.rs`，让 sidecar 支持 8 个 model family + 完整 VAD 分段识别。
- **阶段 4**：`src-tauri/src/commands/asr.rs` 的 `transcribe_with_funasr` / `check_funasr_environment` / `validate_model_dir` 改为从 manifest 读取 family + recognizer_config + silero-vad 路径，传给 sidecar。
- **阶段 5**：前端 UI 扩展——`ASRSettingsPanel.tsx`、`ASRPanel.tsx`、`ModelDownloadPanel.tsx`、`useASR.ts`、`appStore.ts` 改为动态渲染 22 个模型 + 共享资源 + 推荐徽标，默认 model_id 切到新 manifest id。

每个阶段的实施都基于实际 Phase 1 探索结果（已读取的代码 + docs.rs sherpa-onnx 1.13.3 API 文档），不臆测 API。

## Current State Analysis（截至本计划撰写时）

### 已完成（无需再做）

| 文件 | 已完成内容 |
|------|-----------|
| `src-tauri/src/commands/model_manifest.rs` | manifest 解析模块，`OnceLock` 缓存，`load_manifest` / `find_model` / `find_shared_asset` / `enabled_models` / `sorted_download_sources` |
| `src-tauri/src/commands/model.rs` | `list_available_models` / `check_model_downloaded` / `check_all_models_downloaded` / `download_model`（归档下载+解压）/ `list_shared_assets` / `download_shared_asset` / `check_shared_asset_downloaded` / `download_all_models_and_assets` / `find_model_dir` / `find_shared_asset_path` |
| `src-tauri/src/commands/mod.rs` | 注册 `pub mod model_manifest;` |
| `src-tauri/src/lib.rs` | 已注册全部新 commands（含 `download_all_models_and_assets`、`list_shared_assets`、`download_shared_asset`、`check_shared_asset_downloaded`） |
| `src-tauri/Cargo.toml` | 已加 `tar = "0.4"`、`bzip2 = "0.4"` |
| `src-tauri/tauri.conf.json` | resources 改为 `["../models.json", "binaries/*"]` |
| `src/types/model.ts` | `AvailableModel` / `RecognizerConfig` / `SharedAssetDto` / `ArtifactDto` / `ManifestFileDto` / `DownloadSourceDto` 全部对齐；`MODEL_FAMILY_LABELS`、`DEFAULT_MODEL_ID = 'sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17'` 已定义 |
| `src-tauri/sidecars/funasr-asr/Cargo.toml` | `sherpa-onnx = { version = "1.13.3", features = ["vad"] }` + `serde` + `serde_json` 已加 |

### 未完成（本计划目标）

| 维度 | 当前状态 | 问题 |
|------|---------|------|
| `sidecar main.rs` | 仍硬编码 `is_paraformer_model()` 按目录名判断，无 `--model-type` / `--recognizer-config` / `--vad-model` 参数 | 8 个 family 中 6 个会创建失败；VAD 完全未集成 |
| `sidecar validate_args` | 硬编码要求 `model.int8.onnx` + `tokens.txt` | Whisper 需要 `tiny.en-encoder.int8.onnx` 等，Moonshine 需要 4 个 onnx，nemo_transducer 需要 encoder+decoder+joiner |
| `sidecar split_text_to_chunks` | 按字数比例伪造时间戳 | 必须删，时间戳改由 VAD segment 提供 |
| `asr.rs::transcribe_with_funasr` | 仅传 `--input/--model/--language/--output-json` | 未传 model_type / recognizer_config / vad 路径，sidecar 无法识别非 SenseVoice/Paraformer |
| `asr.rs::check_funasr_environment` | 默认 model_id `'sensevoice-small-int8'`，`validate_model_dir` 用 `required_model_files` 硬编码 | 默认 id 不存在；校验逻辑脱离 manifest |
| `ASRSettingsPanel::MODEL_NAMES` | 硬编码 2 条 id→name 映射（行 20-23） | 添加模型需手改前端 |
| `ASRPanel.tsx` 行 382-394 | 硬编码 2 个 SelectItem | 同上 |
| `ModelDownloadPanel.tsx` | 仍调 `download_all_models`（已不存在的 command，会报错）；无 shared_assets 区块；无 family 分组；无 recommended 徽标 | 22 个模型未分组；VAD 无法独立下载 |
| `appStore.ts` 行 135 | `asrModelId: 'sensevoice-small-int8'` | 旧 id 在 manifest 中不存在 |

### sherpa-onnx 1.13.3 实际 API（Phase 1 已通过 docs.rs 确认）

> ⚠️ 本节是原计划文件的 API 修正版。原计划假设的 `VadModel`、`compute_speech_segments`、`speech_pad_ms`、`OfflineTelespeechModelConfig` 等**全部不存在**，必须按以下实际 API 实现。

**VAD 切段**：
- 入口 struct：`VoiceActivityDetector`（**不是 `VadModel`**）
- 构造：`VoiceActivityDetector::create(config: &VadModelConfig, buffer_size_in_seconds: f32) -> Option<Self>`
- 切段流程：
  1. `vad.accept_waveform(samples: &[f32])`（**注意：无 sample_rate 参数**，sample_rate 在 config 里）
  2. 循环 `while !vad.is_empty() { let seg = vad.front().unwrap(); ...; vad.pop(); }`
  3. 末尾 `vad.flush()` 再循环取剩余段

**`VadModelConfig`** 字段：
```rust
pub struct VadModelConfig {
    pub silero_vad: SileroVadModelConfig,   // 必填
    pub ten_vad: TenVadModelConfig,         // 可选另一拨型，不用
    pub sample_rate: i32,                   // 16000
    pub num_threads: i32,
    pub provider: Option<String>,
    pub debug: bool,
}
```

**`SileroVadModelConfig`** 字段（**阈值参数在这里，单位是秒不是毫秒，无 `speech_pad_ms`**）：
```rust
pub struct SileroVadModelConfig {
    pub model: Option<String>,              // silero_vad.onnx 路径
    pub threshold: f32,                     // 0.5
    pub min_silence_duration: f32,          // 秒，0.5（不是 min_silence_duration_ms）
    pub min_speech_duration: f32,           // 秒，0.0
    pub window_size: i32,                   // 512（16k）
    pub max_speech_duration: f32,           // 秒，30.0
}
// 没有 speech_pad_ms 字段（C API 有，Rust 绑定未暴露）。如需 padding，sidecar 自己在切段后扩 start/end。
```

**`SpeechSegment`** 字段（**字段私有，方法访问，无 `end`**）：
```rust
pub fn start(&self) -> i32       // 起始采样索引（相对累计输入）
pub fn samples(&self) -> &[f32]  // 该段 PCM f32
pub fn n(&self) -> i32           // 该段样本数
// end_sample = start + n；start_sec = start / sample_rate
```

**`Wave`**：
```rust
pub fn read(filename: &str) -> Option<Self>   // 注意：入参 &str 不是 Path；返回 Option 不是 Result
pub fn sample_rate(&self) -> i32
pub fn samples(&self) -> &[f32]               // 归一化 PCM f32
// Wave 是 !Send + !Sync，不能跨线程传；需先取出 sample_rate + samples() 再传
```

**`OfflineRecognizer`** / `OfflineStream` / `OfflineRecognizerResult`：
```rust
// OfflineRecognizer
pub fn create(config: &OfflineRecognizerConfig) -> Option<Self>
pub fn create_stream(&self) -> OfflineStream
pub fn decode(&self, stream: &OfflineStream)    // 方法名是 decode，不是 decode_stream

// OfflineStream
pub fn accept_waveform(&self, sample_rate: i32, samples: &[f32])   // 注意：这里带 sample_rate
pub fn get_result(&self) -> Option<OfflineRecognizerResult>

// OfflineRecognizerResult（类型名带 Recognizer，不是 Recognition）
pub struct OfflineRecognizerResult {
    pub text: String,
    pub tokens: Vec<String>,
    pub timestamps: Option<Vec<f32>>,   // 单位秒，与 tokens 等长（模型支持时才有）
    pub durations: Option<Vec<f32>>,
}
```

**`OfflineModelConfig`** 各 family 子字段（**关键修正：telespeech_ctc 是 `Option<String>` 不是 struct**）：
```rust
pub struct OfflineModelConfig {
    pub transducer:       OfflineTransducerModelConfig,    // nemo_transducer family 用这个
    pub paraformer:       OfflineParaformerModelConfig,
    pub whisper:          OfflineWhisperModelConfig,
    pub sense_voice:      OfflineSenseVoiceModelConfig,
    pub moonshine:        OfflineMoonshineModelConfig,
    pub fire_red_asr:     OfflineFireRedAsrModelConfig,
    pub zipformer_ctc:    OfflineZipformerCtcModelConfig,
    pub telespeech_ctc:   Option<String>,                  // 不是 struct！直接放路径
    // ... 其他 family 略
    pub tokens:           Option<String>,
    pub num_threads:      i32,
    pub provider:         Option<String>,
    pub model_type:       Option<String>,
    pub debug:            bool,
    // ...
}
```

**各 family 子 struct 实际字段名**（与 manifest recognizer_config 字段对齐）：

| family | Rust struct | 字段（与 manifest 对齐） |
|--------|-------------|----------------------|
| sense_voice | `OfflineSenseVoiceModelConfig` | `model: Option<String>` ← manifest `sense_voice_model`；`language: Option<String>`；`use_itn: bool` |
| paraformer | `OfflineParaformerModelConfig` | `model: Option<String>` ← manifest `paraformer_model`（仅此一个字段） |
| whisper | `OfflineWhisperModelConfig` | `encoder: Option<String>` ← manifest `whisper_encoder`；`decoder: Option<String>` ← `whisper_decoder`；`language: Option<String>`；`task: Option<String>`；`tail_paddings: i32`；`enable_segment_timestamps: bool` |
| moonshine | `OfflineMoonshineModelConfig` | `preprocessor: Option<String>` ← `moonshine_preprocessor`；`encoder: Option<String>` ← `moonshine_encoder`；`uncached_decoder: Option<String>` ← `moonshine_uncached_decoder`；`cached_decoder: Option<String>` ← `moonshine_cached_decoder`；`merged_decoder: Option<String>`（v2 用，manifest 用 v1 不填） |
| telespeech_ctc | **直接赋值** `config.model_config.telespeech_ctc = Some(path)` | manifest `telespeech_ctc_model` 字段值 |
| zipformer_ctc | `OfflineZipformerCtcModelConfig` | 需在执行时补抓 docs.rs 确认字段名（manifest 用 `zipformer_ctc_model`，推测字段是 `model: Option<String>`） |
| nemo_transducer | `OfflineTransducerModelConfig` | `encoder: Option<String>` ← manifest `encoder`；`decoder: Option<String>` ← `decoder`；`joiner: Option<String>` ← `joiner` |
| fire_red_asr | `OfflineFireRedAsrModelConfig` | 需在执行时补抓 docs.rs 确认字段名（manifest 用 `fire_red_asr_encoder` + `fire_red_asr_decoder`，推测是 transducer 风格 `encoder` / `decoder`） |

> **执行时补抓**：`zipformer_ctc` 与 `fire_red_asr` 两个 struct 的字段名未在 Phase 1 中抓全。执行阶段 3.2 前用 WebFetch 抓 `https://docs.rs/sherpa-onnx/1.13.3/sherpa_onnx/struct.OfflineZipformerCtcModelConfig.html` 与 `https://docs.rs/sherpa-onnx/1.13.3/sherpa_onnx/struct.OfflineFireRedAsrModelConfig.html` 确认。若字段名与 manifest 不符，sidecar 端做映射转换（manifest 字段→sherpa-onnx 字段）。

## Proposed Changes

### 阶段 3.2：sidecar main.rs 重构

**文件**：`src-tauri/sidecars/funasr-asr/src/main.rs`（完全重写）

#### 3.2.1 参数协议扩展

```text
funasr-asr \
  --input <媒体文件> \
  --model <模型目录> \
  --model-type <sense_voice|paraformer|whisper|moonshine|telespeech_ctc|zipformer_ctc|nemo_transducer|fire_red_asr> \
  --recognizer-config <JSON 字符串> \
  --vad-model <silero_vad.onnx 路径> \
  --language <zh|en|auto|...> \
  --output-json
```

- `--model-type`：与 manifest 的 `family` 字段一致，sidecar 据此分发到对应 sherpa-onnx Config
- `--recognizer-config`：Tauri command 把 manifest 的 `recognizer_config` 对象序列化为 JSON 字符串传入
- `--vad-model`：silero_vad.onnx 路径，**必填**（manifest 中 `required_shared_asset_ids: ["silero-vad"]`）
- `--language`：保留，用于日志与兜底（recognizer_config 已含 language 时以 config 为准）

#### 3.2.2 RecognizerConfig 反序列化类型

```rust
#[derive(Debug, Deserialize)]
struct RecognizerConfig {
    model_type: String,
    tokens: String,
    // sense_voice
    #[serde(default)]
    sense_voice_model: Option<String>,
    // paraformer
    #[serde(default)]
    paraformer_model: Option<String>,
    // whisper
    #[serde(default)]
    whisper_encoder: Option<String>,
    #[serde(default)]
    whisper_decoder: Option<String>,
    // moonshine
    #[serde(default)]
    moonshine_preprocessor: Option<String>,
    #[serde(default)]
    moonshine_encoder: Option<String>,
    #[serde(default)]
    moonshine_uncached_decoder: Option<String>,
    #[serde(default)]
    moonshine_cached_decoder: Option<String>,
    // telespeech_ctc / zipformer_ctc
    #[serde(default)]
    telespeech_ctc_model: Option<String>,
    #[serde(default)]
    zipformer_ctc_model: Option<String>,
    // nemo_transducer
    #[serde(default)]
    encoder: Option<String>,
    #[serde(default)]
    decoder: Option<String>,
    #[serde(default)]
    joiner: Option<String>,
    // fire_red_asr
    #[serde(default)]
    fire_red_asr_encoder: Option<String>,
    #[serde(default)]
    fire_red_asr_decoder: Option<String>,
    // 通用
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    use_itn: Option<bool>,
    #[serde(default)]
    task: Option<String>,
    #[serde(default)]
    sample_rate: Option<i32>,
    #[serde(default)]
    feature_dim: Option<i32>,
    #[serde(default)]
    num_threads: Option<i32>,
}
```

所有 manifest 中没有的字段用 `#[serde(default)]` + `Option`，反序列化时不会因字段缺失失败。

#### 3.2.3 build_recognizer 分发

```rust
fn build_recognizer(config: &RecognizerConfig, model_dir: &Path) -> Result<OfflineRecognizer, String> {
    let mut mc = OfflineModelConfig::default();
    mc.tokens = Some(model_dir.join(&config.tokens).to_string_lossy().to_string());
    mc.num_threads = config.num_threads.unwrap_or(2);
    mc.provider = Some("cpu".to_string());
    mc.debug = false;

    let resolve = |rel: &Option<String>| -> Option<String> {
        rel.as_ref().map(|p| model_dir.join(p).to_string_lossy().to_string())
    };

    match config.model_type.as_str() {
        "sense_voice" => {
            mc.sense_voice = OfflineSenseVoiceModelConfig {
                model: resolve(&config.sense_voice_model),
                language: config.language.clone().or(Some("auto".to_string())),
                use_itn: config.use_itn.unwrap_or(true),
            };
            mc.model_type = Some("sense_voice".to_string());
        }
        "paraformer" => {
            mc.paraformer = OfflineParaformerModelConfig {
                model: resolve(&config.paraformer_model),
            };
            mc.model_type = Some("paraformer".to_string());
        }
        "whisper" => {
            mc.whisper = OfflineWhisperModelConfig {
                encoder: resolve(&config.whisper_encoder),
                decoder: resolve(&config.whisper_decoder),
                language: config.language.clone().or(Some("en".to_string())),
                task: config.task.clone().or(Some("transcribe".to_string())),
                tail_paddings: -1,
                enable_token_timestamps: false,
                enable_segment_timestamps: false,
            };
            mc.model_type = Some("whisper".to_string());
        }
        "moonshine" => {
            mc.moonshine = OfflineMoonshineModelConfig {
                preprocessor: resolve(&config.moonshine_preprocessor),
                encoder: resolve(&config.moonshine_encoder),
                uncached_decoder: resolve(&config.moonshine_uncached_decoder),
                cached_decoder: resolve(&config.moonshine_cached_decoder),
                merged_decoder: None,  // manifest 用 v1，不填
            };
            mc.model_type = Some("moonshine".to_string());
        }
        "telespeech_ctc" => {
            // telespeech_ctc 是 OfflineModelConfig 的 Option<String> 字段，直接放路径
            mc.telespeech_ctc = resolve(&config.telespeech_ctc_model);
            mc.model_type = Some("telespeech_ctc".to_string());
        }
        "zipformer_ctc" => {
            mc.zipformer_ctc = OfflineZipformerCtcModelConfig {
                model: resolve(&config.zipformer_ctc_model),
                // 执行时补抓 docs.rs 确认是否还有其他必填字段
            };
            mc.model_type = Some("zipformer_ctc".to_string());
        }
        "nemo_transducer" => {
            mc.transducer = OfflineTransducerModelConfig {
                encoder: resolve(&config.encoder),
                decoder: resolve(&config.decoder),
                joiner: resolve(&config.joiner),
            };
            mc.model_type = Some("nemo_transducer".to_string());
        }
        "fire_red_asr" => {
            // 执行时补抓 docs.rs 确认 OfflineFireRedAsrModelConfig 字段名
            // 推测是 transducer 风格 encoder/decoder；若不符则用 fire_red_asr_ctc
            mc.fire_red_asr = OfflineFireRedAsrModelConfig {
                encoder: resolve(&config.fire_red_asr_encoder),
                decoder: resolve(&config.fire_red_asr_decoder),
                // 其他字段待 docs.rs 确认
            };
            mc.model_type = Some("fire_red_asr".to_string());
        }
        other => return Err(format!("不支持的 model_type: {other}")),
    }

    let mut cfg = OfflineRecognizerConfig::default();
    cfg.model_config = mc;
    cfg.decoding_method = Some("greedy_search".to_string());

    OfflineRecognizer::create(&cfg)
        .ok_or_else(|| format!("创建 OfflineRecognizer 失败（model_type={}）。请确认模型文件完整且与 family 匹配。", config.model_type))
}
```

> **执行注意**：`OfflineWhisperModelConfig` / `OfflineMoonshineModelConfig` / `OfflineZipformerCtcModelConfig` / `OfflineFireRedAsrModelConfig` 的精确字段（是否有 `tail_paddings` / `enable_token_timestamps` 等）需在执行时 `cargo doc --open` 或查 docs.rs 确认。若字段不存在，删除该行即可（用 `..Default::default()` 兜底）。

#### 3.2.4 VAD 分段识别流程

替换现有 `recognize` 函数为 `recognize_with_vad`：

```rust
fn recognize_with_vad(
    recognizer: &OfflineRecognizer,
    vad_model_path: &Path,
    wav_path: &Path,
    config: &RecognizerConfig,
) -> Result<RecognitionOutput, String> {
    let wav_path_str = wav_path.to_str()
        .ok_or_else(|| format!("音频路径包含非法字符：{}", wav_path.display()))?;
    let wave = Wave::read(wav_path_str)
        .ok_or_else(|| format!("无法读取 WAV 音频：{}", wav_path.display()))?;
    let sample_rate = wave.sample_rate();
    let samples = wave.samples().to_vec();  // 复制一份，因为 Wave !Send 且后续要多次用

    // 1. 构造 VAD
    let mut vad_config = VadModelConfig::default();
    vad_config.silero_vad = SileroVadModelConfig {
        model: Some(vad_model_path.to_string_lossy().to_string()),
        threshold: 0.5,
        min_silence_duration: 0.5,   // 秒
        min_speech_duration: 0.0,   // 秒
        window_size: 512,           // 16k 标准
        max_speech_duration: 30.0,  // 秒，超过 30s 强切
    };
    vad_config.sample_rate = sample_rate;
    vad_config.num_threads = 1;
    vad_config.provider = Some("cpu".to_string());
    vad_config.debug = false;

    // buffer_size_in_seconds: 60 秒缓冲足够；若音频更长会自动 flush
    let vad = VoiceActivityDetector::create(&vad_config, 60.0)
        .ok_or_else(|| "创建 silero VAD 失败，请确认 silero_vad.onnx 路径正确".to_string())?;

    // 2. VAD 切段（按 window_size 步进喂数据）
    let window = vad_config.silero_vad.window_size as usize;
    let mut segments: Vec<(usize, Vec<f32>)> = Vec::new();  // (start_sample, samples)

    let mut i = 0;
    while i + window <= samples.len() {
        vad.accept_waveform(&samples[i..i + window]);
        while !vad.is_empty() {
            if let Some(seg) = vad.front() {
                let start = seg.start() as usize;
                let seg_samples = seg.samples().to_vec();
                segments.push((start, seg_samples));
                vad.pop();
            }
        }
        i += window;
    }
    // 末尾 flush 剩余
    if i < samples.len() {
        vad.accept_waveform(&samples[i..]);
    }
    vad.flush();
    while !vad.is_empty() {
        if let Some(seg) = vad.front() {
            let start = seg.start() as usize;
            let seg_samples = seg.samples().to_vec();
            segments.push((start, seg_samples));
            vad.pop();
        }
    }

    // 3. 每段独立识别，合并时间戳
    let mut chunks = Vec::new();
    let mut full_text = String::new();

    for (idx, (start_sample, seg_samples)) in segments.iter().enumerate() {
        if seg_samples.is_empty() {
            continue;
        }
        let stream = recognizer.create_stream();
        stream.accept_waveform(sample_rate, seg_samples);
        recognizer.decode(&stream);

        if let Some(result) = stream.get_result() {
            let text = result.text.trim().to_string();
            if !text.is_empty() {
                let start_sec = *start_sample as f64 / sample_rate as f64;
                let end_sec = (*start_sample + seg_samples.len()) as f64 / sample_rate as f64;
                chunks.push(SubtitleChunk {
                    text: text.clone(),
                    start: start_sec,
                    end: end_sec,
                });
                full_text.push_str(&text);
                full_text.push(' ');
            }
        }
    }

    // 4. 兜底：VAD 未切出任何段（静音或失败），回退整段识别
    if chunks.is_empty() {
        let stream = recognizer.create_stream();
        stream.accept_waveform(sample_rate, &samples);
        recognizer.decode(&stream);
        if let Some(result) = stream.get_result() {
            let text = result.text.trim().to_string();
            if !text.is_empty() {
                chunks.push(SubtitleChunk {
                    text: text.clone(),
                    start: 0.0,
                    end: samples.len() as f64 / sample_rate as f64,
                });
                full_text = text;
            }
        }
    }

    if chunks.is_empty() {
        return Err("VAD 与整段识别均未识别到字幕文本，请确认视频包含清晰人声或尝试更换模型".to_string());
    }

    let duration = samples.len() as f64 / sample_rate as f64;
    Ok(RecognitionOutput { text: full_text.trim().to_string(), duration, chunks })
}
```

> **关键修正**（vs 原计划）：
> - 用 `VoiceActivityDetector` 不是 `VadModel`
> - 参数在 `SileroVadModelConfig` 里，单位是秒不是毫秒
> - 无 `speech_pad_ms`（Rust 绑定未暴露），padding 由 sidecar 自己在 chunk start/end 做微调（当前不做，VAD 段已够用）
> - 切段用 `accept_waveform` → `front()` + `pop()` 循环 → `flush()`，**不是全局 `compute_speech_segments`**
> - `seg.start()` 返回采样索引，`end = start + seg.n()`，时间换算 `/ sample_rate`
> - `OfflineStream::accept_waveform(sample_rate, samples)` 带 sample_rate（与 VAD 的 `accept_waveform(samples)` 签名不同）
> - `recognizer.decode(&stream)` 方法名是 `decode`，返回 `OfflineRecognizerResult`（不是 `OfflineRecognitionResult`）

#### 3.2.5 validate_args 改造

```rust
fn validate_args(args: &Args) -> Result<(), String> {
    if !args.input.is_file() {
        return Err(format!("输入文件不存在或不是文件：{}", args.input.display()));
    }
    if !args.model.is_dir() {
        return Err(format!("模型目录不存在或不是目录：{}", args.model.display()));
    }
    // 校验 vad-model 文件存在
    let vad = args.vad_model.as_ref()
        .ok_or_else(|| "缺少 --vad-model 参数".to_string())?;
    if !vad.is_file() {
        return Err(format!("VAD 模型文件不存在：{}", vad.display()));
    }
    // recognizer_config 反序列化后，校验 tokens 文件 + 各 family 字段引用的文件存在
    if let Some(config) = &args.recognizer_config {
        let tokens_path = args.model.join(&config.tokens);
        if !tokens_path.is_file() {
            return Err(format!("模型目录缺少 tokens 文件：{}", tokens_path.display()));
        }
        // 校验 family 特定文件
        let check = |rel: &Option<String>, name: &str| -> Result<(), String> {
            if let Some(p) = rel {
                let full = args.model.join(p);
                if !full.is_file() {
                    return Err(format!("模型目录缺少 {name}：{}", full.display()));
                }
            }
            Ok(())
        };
        check(&config.sense_voice_model, "sense_voice_model")?;
        check(&config.paraformer_model, "paraformer_model")?;
        check(&config.whisper_encoder, "whisper_encoder")?;
        check(&config.whisper_decoder, "whisper_decoder")?;
        // ... 其他 family 同理
    }
    Ok(())
}
```

#### 3.2.6 删除伪造时间戳逻辑

删除 `split_text_to_chunks` 与 `push_subtitle_piece` 两个函数。chunk 时间戳完全由 VAD segment 提供。

#### 3.2.7 Args 结构扩展

```rust
#[derive(Debug)]
struct Args {
    input: PathBuf,
    model: PathBuf,
    model_type: String,
    recognizer_config: Option<RecognizerConfig>,  // 解析后的 config
    recognizer_config_raw: String,                 // 原始 JSON 字符串（用于错误信息）
    vad_model: Option<PathBuf>,
    language: String,
    output_json: bool,
}
```

`parse_args` 增加分支：`--model-type`、`--recognizer-config`、`--vad-model`。`--recognizer-config` 解析后存入 `recognizer_config`，原始字符串存 `recognizer_config_raw`。

### 阶段 4：Tauri command 串联

**文件**：`src-tauri/src/commands/asr.rs`

#### 4.1 transcribe_with_funasr 扩展

```rust
#[tauri::command]
pub async fn transcribe_with_funasr(
    app: AppHandle,
    input_path: String,
    language: Option<String>,
    model_id: Option<String>,
) -> Result<TranscriptResult, String> {
    let active_model_id = model_id
        .unwrap_or_else(|| "sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17".to_string());

    let manifest = crate::commands::model_manifest::load_manifest(&app)?;
    let model = crate::commands::model_manifest::find_model(manifest, &active_model_id)
        .ok_or_else(|| format!("模型 {} 不在 manifest 中", active_model_id))?;
    if !model.enabled {
        return Err(format!("模型 {} 已被禁用", active_model_id));
    }

    let model_dir = crate::commands::model::find_model_dir(&app, &active_model_id)?;
    validate_model_dir(&model_dir, model)?;  // 改签名：接收 &ManifestModel
    let binary = sidecar_path(&app)?;

    // VAD 路径（manifest 中 required_shared_asset_ids 含 silero-vad）
    let vad_path = crate::commands::model::find_shared_asset_path(&app, "silero-vad")?;

    let recognizer_config_json = serde_json::to_string(&model.recognizer_config)
        .map_err(|e| format!("序列化 recognizer_config 失败: {e}"))?;

    let lang = language.unwrap_or_else(|| "zh".to_string());
    let family = model.family.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new(&binary)
            .arg("--input").arg(&input_path)
            .arg("--model").arg(model_dir.to_str().unwrap_or(""))
            .arg("--model-type").arg(&family)
            .arg("--recognizer-config").arg(&recognizer_config_json)
            .arg("--vad-model").arg(vad_path.to_str().unwrap_or(""))
            .arg("--language").arg(&lang)
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
        let result: TranscriptResult = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse FunASR output as JSON: {e}\nRaw output:\n{stdout}"))?;
        Ok(result)
    })
    .await
    .map_err(|e| format!("FunASR sidecar task failed: {e}"))?
}
```

#### 4.2 check_funasr_environment 改造

- 默认 model_id 从 `'sensevoice-small-int8'` 改为 `'sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17'`
- `validate_model_dir` 改为接收 `&ManifestModel`，遍历 `model.files` 检查存在性（替代 `required_model_files` 硬编码）
- 删除 `required_model_files` 与 `fn required_model_files(model_id: &str)` 函数
- `missing_model_files` 改为遍历 manifest model.files 输出缺失文件路径

```rust
fn validate_model_dir(model_dir: &std::path::Path, model: &crate::commands::model_manifest::ManifestModel) -> Result<(), String> {
    let missing: Vec<String> = model.files.iter()
        .filter(|f| !model_dir.join(&f.path).is_file())
        .map(|f| f.path.clone())
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "FunASR 模型文件不完整：模型目录 {} 缺少 {}。请先在模型下载面板下载完整模型。",
            model_dir.display(),
            missing.join(", ")
        ))
    }
}
```

`check_funasr_environment` 中 `missing_model_files` 同样改为遍历 manifest model.files。

#### 4.3 移除 model.rs 中的旧 download_all_models 引用

`ModelDownloadPanel.tsx` 当前调 `invoke('download_all_models')`（已不存在的 command，会报错），改为 `invoke('download_all_models_and_assets')`。该改动在前端阶段处理。

### 阶段 5：前端 UI 扩展

#### 5.1 ASRSettingsPanel.tsx

**文件**：`src/components/ProcessingPanel/ASRSettingsPanel.tsx`

改动：
1. **删除 `MODEL_NAMES` 常量**（行 20-23）
2. 在 `useEffect` 中追加调用 `invoke<AvailableModel[]>('list_available_models')`，存入新 state `allModels: AvailableModel[]`
3. 渲染已下载模型 Select 时：
   - 按 `family` 分组，每组用 `<SelectGroup>` + `<SelectLabel>{MODEL_FAMILY_LABELS[family]}</SelectLabel>`
   - 每个 `<SelectItem value={model.id}>` 显示 `model.name`，若 `model.recommended=true` 在名称后追加 ` (推荐)`
   - 已下载模型集合 `downloadedModels: string[]` 与 `allModels` 做交集，得到要渲染的 model 列表
4. `changeModel` 中 toast 显示的模型名从 `MODEL_NAMES[modelId]` 改为查 `allModels.find(m => m.id === modelId)?.name || modelId`

#### 5.2 ASRPanel.tsx

**文件**：`src/components/ProcessingPanel/ASRPanel.tsx`（行 376-394 区域）

改动：删除硬编码的 2 个 `<SelectItem>`（`sensevoice-small-int8` / `paraformer-small-int8`），改为与 `ASRSettingsPanel` 共用一份渲染逻辑。考虑抽到 `src/components/ASR/ModelSelectItems.tsx` 公共组件，导出 `<ModelSelectItems downloadedModels={...} allModels={...} />`，两个面板共用。

`changeModel` 回调（行 206-210）的 toast 文案从 `modelId === 'sensevoice-small-int8' ? 'SenseVoice Small' : 'Paraformer Small'` 改为查 `allModels.find(m => m.id === modelId)?.name || modelId`。

#### 5.3 ModelDownloadPanel.tsx

**文件**：`src/components/ASR/ModelDownloadPanel.tsx`

改动：
1. **修复已失效的 command 调用**：行 94 `invoke<AllModelsStatus>('download_all_models')` 改为 `invoke<AllModelsStatus>('download_all_models_and_assets')`
2. 新增 state `sharedAssets: SharedAssetDto[]` + `sharedAssetStatus: Record<string, boolean>`，从 `list_shared_assets` + `check_shared_asset_downloaded` 加载
3. **新增 "共享资源" section**（在 Whisper section 与 FunASR section 之间）：
   - 标题：`<Package />` + "共享资源 (VAD)"
   - 每个 shared asset 一张卡片：名称、描述、单独下载按钮（调 `invoke('download_shared_asset', { assetId: 'silero-vad' })`）
   - 下载进度复用 `model-download-progress` 事件监听（payload.model_id === 'silero-vad' 时更新 sharedAssetProgress state）
4. **FunASR 模型按 family 分组**：
   - 用 `MODEL_FAMILY_LABELS` 把 `models` 按 `family` 分组
   - 每组一个子 section：标题（如 "SenseVoice 多语种"）+ 该组所有模型的卡片
   - 每个模型卡片：名称前若 `recommended=true` 显示 `<Badge variant="default">推荐</Badge>`；描述下方加 `family` 标签（小字 muted）和 `size_mb_estimate`（如有）
5. **下载进度**：现有 `model-download-progress` 事件监听保持不变，只需确保 `downloadingType === 'funasr'` 时的进度条仍然显示

#### 5.4 useASR.ts + appStore.ts 默认 model_id

**文件**：`src/hooks/useASR.ts` + `src/stores/appStore.ts`

改动：
- `appStore.ts` 行 135：`asrModelId: 'sensevoice-small-int8'` → `asrModelId: 'sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17'`（直接用 `DEFAULT_MODEL_ID` 常量，从 `@/types/model` 导入）
- `useASR.ts` 无需改默认值（它读 store 的 `asrModelId`），但要确认 `invoke('transcribe_with_funasr', { inputPath, language, modelId })` 透传 `asrModelId` 到后端（已经是这样，确认即可）

#### 5.5 FunASRTauriEngine.ts

**文件**：`src/services/asrEngines/FunASRTauriEngine.ts`

确认 `invoke('transcribe_with_funasr', { inputPath, language, modelId })` 透传 `modelId`（已透传，无需改）。`loadModel` 中 `invoke('check_funasr_environment', { modelId })` 也已透传。

## Assumptions & Decisions

1. **VAD 参数固定**：threshold=0.5, min_silence_duration=0.5s, min_speech_duration=0.0s, window_size=512, max_speech_duration=30.0s。这些是合理默认，UI 暴露调参作为后续任务。
2. **无 `speech_pad_ms`**：sherpa-onnx 1.13.3 Rust 绑定未暴露此参数。VAD 段本身就含合理边界，无需额外 padding。若后续发现段太紧贴，再在 sidecar 端手工扩 start/end 各 100ms。
3. **VAD buffer_size_in_seconds=60**：足够容纳大多数音频末尾 flush。若音频超 60s 也会被分批处理（每 window 推送一次），不会丢数据。
4. **whisper enable_segment_timestamps=false**：本轮只用 VAD segment 时间戳，不开 whisper 自带 segment timestamps（避免与 VAD 时间戳冲突）。
5. **zipformer_ctc / fire_red_asr 字段待确认**：执行阶段 3.2 前用 WebFetch 补抓 docs.rs 确认 `OfflineZipformerCtcModelConfig` / `OfflineFireRedAsrModelConfig` 的字段名。若与 manifest 字段不符，sidecar 端做映射转换。
6. **删除旧 id 兼容**：`find_model_dir` 中 `sensevoice-small-int8` 旧版目录兼容分支已在阶段 1 删除。用户之前下载到 `app_data_dir/models/sensevoice-small-int8/` 的模型在新 id 体系下需要重新下载。这是破坏性变更，需在升级说明里写明。
7. **不重构进度回调为流式**：本轮 `transcribe_with_funasr` 仍用 `Command::output()` 一次性等待。VAD 分段会让长音频识别更慢，但前端文案改为 "正在使用 VAD 分段识别，长音频可能需要较长时间..."。流式进度作为下一阶段独立任务。
8. **ModelSelectItems 公共组件**：`ASRSettingsPanel` 与 `ASRPanel` 共用一份模型下拉渲染逻辑，避免重复。新文件 `src/components/ASR/ModelSelectItems.tsx`。
9. **download_all_models command 已不存在**：`ModelDownloadPanel.tsx` 行 94 调用的 `download_all_models` 已被替换为 `download_all_models_and_assets`，前端必须同步改名，否则点击会报错。
10. **family 分组顺序**：UI 按 `MODEL_FAMILY_LABELS` 的 key 顺序渲染（sense_voice → paraformer → whisper → moonshine → telespeech_ctc → zipformer_ctc → nemo_transducer → fire_red_asr），跳过没有已下载模型的 family（下载面板里则全部显示）。

## Verification Steps

### 阶段 3.2 验证（sidecar）

```bash
# 1. 编译 sidecar
pnpm build:funasr-sidecar

# 2. 确认 sherpa-onnx vad feature 编译通过（无 link error）

# 3. 手动调用 sidecar（sense_voice family）
./src-tauri/binaries/funasr-asr \
  --input test.wav \
  --model <app_data_dir>/models/sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17 \
  --model-type sense_voice \
  --recognizer-config '{"model_type":"sense_voice","sense_voice_model":"model.int8.onnx","tokens":"tokens.txt","language":"auto","use_itn":true,"sample_rate":16000,"feature_dim":80,"num_threads":2}' \
  --vad-model <app_data_dir>/shared_assets/silero-vad/silero_vad.onnx \
  --language zh \
  --output-json

# 4. 对 8 个 family 各跑一个模型，确认 stdout 返回合法 JSON，chunks 时间戳为 VAD 真实分段（非字数比例）
# 5. 确认长音频（>30 秒）被切成多段，每段时间戳连续递增
```

### 阶段 4 验证（command 串联）

```bash
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tsc -b --noEmit
```

Tauri 端通过 `invoke('transcribe_with_funasr', { inputPath, language, modelId })` 调用，确认 22 个模型中至少 sense_voice / paraformer / whisper-tiny / moonshine / fire_red_asr 各跑通一个样例。

### 阶段 5 验证（前端 UI）

```bash
pnpm tsc -b --noEmit
pnpm lint
pnpm tauri dev
```

- ModelDownloadPanel：22 个模型按 family 分组显示，`recommended=true` 的模型显示 "推荐" 徽标
- silero-vad 出现在 "共享资源" section，可独立下载
- ASRSettingsPanel 模型下拉：按 family 分组 `<SelectGroup>`，仅展示已下载模型
- ASRPanel 模型下拉同上
- 端到端：下载 sensevoice → 下载 silero-vad → 选择视频 → 识别 → 字幕出现在编辑器，时间戳为真实分段

### 最终回归（AGENTS.md 要求的验证链路）

```bash
pnpm build:funasr-sidecar && cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc -b --noEmit
```

切换 ASR 引擎为 transformers，确认 Whisper 浏览器本地路径未被破坏。

## 实施顺序

1. **阶段 3.2**：先补抓 `OfflineZipformerCtcModelConfig` / `OfflineFireRedAsrModelConfig` docs.rs → 重写 `main.rs` → `pnpm build:funasr-sidecar` 编译通过
2. **阶段 4**：改 `asr.rs` → `cargo check` 通过
3. **阶段 5**：改前端 4 个文件 → `pnpm tsc -b --noEmit` + `pnpm lint` 通过
4. **最终回归**：`pnpm build:funasr-sidecar && cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc -b --noEmit`
5. **端到端冒烟**：`pnpm tauri dev` → 下载 sensevoice + silero-vad → 跑一个视频识别
