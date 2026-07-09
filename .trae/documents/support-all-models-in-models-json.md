# 支持 models.json 中的全部 22 个模型

## Summary

将 `/Users/zhangxiangchen/Code/demo/flycut-caption/models.json` 作为前后端单一数据源，让全部 22 个模型（覆盖 sense_voice / paraformer / whisper / moonshine / telespeech_ctc / zipformer_ctc / nemo_transducer / fire_red_asr 共 8 个 family）都能在 Tauri 桌面端被下载、选择并真正完成 ASR 识别。

为此需要：
1. **把 models.json 作为 Tauri resource**，Rust 启动时解析，删除 `available_models()` 中的硬编码 2 个模型。
2. **扩展 sidecar 支持全部 8 个 family**，新增 `--model-type` 与 `--recognizer-config` 参数，从 manifest 的 `recognizer_config` 字段读取所有必要路径与超参。
3. **完整集成 VAD**：sidecar 启用 sherpa-onnx `vad` feature，下载 `silero-vad` shared asset，按 VAD 分段识别，输出真实 segment 级时间戳，删除当前 `split_text_to_chunks` 的字数比例伪造逻辑。
4. **前端 UI 扩展**：删除 `ASRSettingsPanel.tsx` 与 `ASRPanel.tsx` 中的硬编码模型清单，改为从 `list_available_models` 动态渲染；按 family 分组、显示 `recommended` 徽标。
5. **归档下载+解压**：models.json 的 `download_sources` 全部指向 `.tar.bz2` 归档，`files` 是解压后的相对路径。需要在 Rust 下载链路增加 tar+bz2 解压能力。

## Current State Analysis

### 现状（探索阶段确认）

| 维度 | 当前状态 | 问题 |
|------|---------|------|
| `models.json` | 22 个模型 + 1 个 shared_asset (silero-vad)，所有 `enabled=true` | **未被任何代码消费** |
| `model.rs::available_models()` | 硬编码 2 个模型（sensevoice-small-int8、paraformer-small-int8） | 严重脱离 manifest |
| sidecar 模型分发 | `is_paraformer_model()` 只看目录名是否含 "paraformer"，否则全部当 SenseVoice | whisper / moonshine / telespeech_ctc / zipformer_ctc / nemo_transducer / fire_red_asr 全部会创建失败 |
| sidecar 文件校验 | 硬性要求 `model.int8.onnx` + `tokens.txt` | Whisper 需要 `tiny.en-encoder.int8.onnx` 等，Parakeet 需要 encoder/decoder/joiner 三件套 |
| VAD | **完全未集成**。sidecar `Cargo.toml` 未启用 vad feature；`main.rs` 全文无 `VoiceActivityDetector` 调用 | 时间戳靠 `split_text_to_chunks` 按字数比例伪造 |
| `transcribe_with_funasr` command | 仅传 `--input/--model/--language/--output-json`，未传 model_type / recognizer_config / vad 路径 | sidecar 无法识别非 SenseVoice/Paraformer 模型 |
| `tauri.conf.json::resources` | 仅 `models/sensevoice/*` + `binaries/*` | 其他 family 模型未打包；但用户下载路径 `app_data_dir/models/<id>` 由 `find_model_dir` 优先读取，可行 |
| 前端 `AvailableModel` 类型 | 缺 `family` / `recommended` / `languages` / `recognizer_config` 字段 | 无法做分组与推荐标记 |
| `ASRSettingsPanel::MODEL_NAMES` | 硬编码 2 条 id→name 映射 | 添加模型需手改前端 |
| `ASRPanel.tsx` 旧版 Select | 硬编码 2 个 SelectItem | 同上 |
| 下载链路 | 仅下载单文件，无解压能力 | models.json 的 URL 全部是 `.tar.bz2`，下载后必须解压到 `extract_dir` |
| 进度回调 | `Command::output()` 一次性等待，无事件流 | 长音频体验差（次要，本轮先不重构为流式） |

### models.json 关键字段（已确认）

```jsonc
{
  "shared_assets": [{ "id": "silero-vad", "files": [{ "path": "silero_vad.onnx" }], "download_sources": [...] }],
  "models": [{
    "id": "...", "name": "...", "family": "sense_voice|paraformer|whisper|moonshine|telespeech_ctc|zipformer_ctc|nemo_transducer|fire_red_asr",
    "enabled": true, "recommended": true|false, "languages": [...],
    "artifact": { "archive_name": "*.tar.bz2", "extract_dir": "..." },
    "files": [{ "path": "..." }],   // 解压后的相对路径
    "recognizer_config": {          // 每个 family 字段不同
      "model_type": "...",
      "sense_voice_model" / "paraformer_model" / "whisper_encoder"+"whisper_decoder" / "moonshine_*" / "telespeech_ctc_model" / "zipformer_ctc_model" / "encoder"+"decoder"+"joiner" / "fire_red_asr_encoder"+"fire_red_asr_decoder",
      "tokens": "...", "language": "...", "use_itn": true, "task": "transcribe",
      "sample_rate": 16000, "feature_dim": 80, "num_threads": 2|4
    },
    "download_sources": [{ "region": "...", "provider": "...", "url": "...", "verify_before_use": true|缺省 }]
  }]
}
```

### 22 个模型 family 分布

- **sense_voice** (3): sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17 / sensevoice-small-fp32-... / sensevoice-small-yue-int8-2025-09-09
- **paraformer** (4): paraformer-zh-int8-2023-09-14 / 2024-03-09 / paraformer-zh-small-int8-2024-03-09 / paraformer-trilingual-zh-cantonese-en-int8
- **moonshine** (1): moonshine-tiny-en-int8
- **whisper** (10): whisper-tiny/base/small/medium-en + distil-small/medium-en + tiny/base/small/medium-multilingual
- **telespeech_ctc** (1): telespeech-ctc-int8-zh-2024-06-04
- **zipformer_ctc** (1): zipformer-ctc-zh-int8-2025-07-03
- **nemo_transducer** (1): parakeet-tdt-0-6b-v3-int8
- **fire_red_asr** (1): firered-asr-large-zh-en-2025-02-16

## Proposed Changes

### 阶段 1：models.json 成为运行时单一数据源

#### 1.1 新建 manifest 解析模块

**新建文件**：`src-tauri/src/commands/model_manifest.rs`

定义与 models.json 完全对齐的 serde 类型：
- `ModelManifest { schema_version, name, description, runtime, timestamp_policy, shared_assets: Vec<SharedAsset>, models: Vec<ManifestModel> }`
- `SharedAsset { id, name, type, description, required_for_subtitle, files: Vec<ManifestFile>, download_sources: Vec<DownloadSource> }`
- `ManifestModel { id, name, family, enabled, recommended, languages, description, mode, quantization, size, supports_subtitle, timestamp, artifact: Artifact, files: Vec<ManifestFile>, recognizer_config: serde_json::Value, download_sources: Vec<DownloadSource> }`
- `ManifestFile { path, sha256: Option<String> }`
- `Artifact { archive_name, extract_dir, size_mb_estimate: Option<f64> }`
- `DownloadSource { region, provider, url, verify_before_use: Option<bool> }`

`recognizer_config` 用 `serde_json::Value` 保存，sidecar 端再按 `model_type` 反序列化为对应类型。这样 manifest 解析层不需要为 8 个 family 各写一份 Rust struct。

提供函数：
- `load_manifest(app: &AppHandle) -> Result<&'static ModelManifest>` — 启动时从 `resource_dir/models.json` 或 dev 路径 `src-tauri/models.json` 读取，`OnceLock<ModelManifest>` 缓存
- `enabled_models(manifest) -> Vec<&ManifestModel>` — 过滤 `enabled == true`
- `find_model(manifest, model_id) -> Option<&ManifestModel>`
- `find_shared_asset(manifest, asset_id) -> Option<&SharedAsset>`

#### 1.2 model.rs 改造

**文件**：`src-tauri/src/commands/model.rs`

- 删除 `fn available_models()` 硬编码实现
- `AvailableModel` / `ModelFile` 类型扩展字段：`family`、`recommended`、`languages`、`artifact`、`recognizer_config`、`download_sources`（保留 `serde` 派生以透传给前端）
- `list_available_models()` 改为：`load_manifest(app)?.enabled_models()` 然后映射成 `Vec<AvailableModel>`
- `check_model_downloaded` / `check_all_models_downloaded`：遍历 `manifest.files` 检查存在性；`size_bytes` 在 manifest 中没有，改为只校验文件存在（不强校验大小，因为 models.json 的 `sha256` 全部为 `null`，无法精确校验）
- `find_model_dir(app, model_id)`：保持现有三级回退逻辑（`app_data_dir/models/<id>` → `resource_dir/models/<id>` → `src-tauri/models/<id>`），删除 `sensevoice-small-int8` 旧版硬编码兼容分支（已被 manifest id 取代）

#### 1.3 tauri.conf.json 资源配置

**文件**：`src-tauri/tauri.conf.json`

```jsonc
"resources": [
  "models.json",            // ← 新增，作为 resource
  "binaries/*",
  // 删除 "models/sensevoice/*"，改为统一从 app_data_dir 下载
]
```

模型本体不再走 resource 内置，统一由用户下载到 `app_data_dir/models/<id>/`。

#### 1.4 前端类型对齐

**文件**：`src/types/model.ts`

扩展 `AvailableModel` 与 `ModelFile`：
```ts
export interface ModelFile { path: string; sha256: string | null; }
export interface Artifact { archive_name: string; extract_dir: string; size_mb_estimate: number | null; }
export interface DownloadSource { region: string; provider: string; url: string; verify_before_use?: boolean; }
export interface RecognizerConfig { [key: string]: unknown; model_type: string; tokens: string; sample_rate?: number; feature_dim?: number; num_threads?: number; }

export interface SharedAsset {
  id: string; name: string; type: string;
  description: string; required_for_subtitle: boolean;
  files: ModelFile[]; download_sources: DownloadSource[];
}

export interface AvailableModel {
  id: string; name: string; family: string;
  enabled: boolean; recommended: boolean;
  languages: string[]; description: string;
  mode: string; quantization?: string; size?: string;
  supports_subtitle: boolean;
  artifact: Artifact;
  files: ModelFile[];
  recognizer_config: RecognizerConfig;
  download_sources: DownloadSource[];
}
```

### 阶段 2：归档下载+解压能力

#### 2.1 download_model 链路改造

**文件**：`src-tauri/src/commands/model.rs`

现状：`download_model_files` 逐文件 HTTP 下载，写入 `dir.join(file.path)`。models.json 的 `download_sources` 指向 `.tar.bz2`，`files` 是解压后的路径。改造为：

1. 对每个 `download_source` URL（按 region 优先级：cn 在前，global 在后），调用现有 `reqwest` 客户端下载 `.tar.bz2` 到临时文件 `<dir>.tmp.tar.bz2`，沿用现有的断点续传与多镜像重试逻辑。
2. 下载成功后用 `bzip2` + `tar` crate 解压（新增依赖 `tar = "0.4"`、`bzip2 = "0.4"` 或 `flate2`，根据 archive 实际格式选择；`.tar.bz2` 用 `bzip2`）。
3. 解压到临时目录，再把 `extract_dir` 子目录的内容移动到 `dir`（因为 tar 包内顶层是 `extract_dir` 目录）。
4. 删除临时归档。
5. 校验 `files` 中所有路径存在。

#### 2.2 shared_assets 下载

**文件**：`src-tauri/src/commands/model.rs`

新增 command：
- `list_shared_assets() -> Vec<SharedAsset>` — 从 manifest 返回
- `download_shared_asset(app, asset_id) -> Result<String, String>` — 下载单个 shared asset 到 `app_data_dir/shared_assets/<id>/`，例如 `app_data_dir/shared_assets/silero-vad/silero_vad.onnx`
- `check_shared_asset_downloaded(app, asset_id) -> Result<Option<String>, String>`
- `find_shared_asset_path(app, asset_id) -> Result<PathBuf, String>` — 内部使用，返回 silero_vad.onnx 完整路径

silero-vad 是单文件下载（不是归档），复用现有单文件下载逻辑即可。

#### 2.3 一键下载

新增 `download_all_models_and_assets(app) -> Result<AllModelsStatus, String>`：先下载 shared_assets，再下载所有 enabled 模型。前端 "一键下载" 按钮改调这个。

### 阶段 3：sidecar 支持 8 个 family + VAD

#### 3.1 Cargo.toml 启用 vad

**文件**：`src-tauri/sidecars/funasr-asr/Cargo.toml`

```toml
[dependencies]
sherpa-onnx = { version = "1.13.3", features = ["vad"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

#### 3.2 sidecar main.rs 重构

**文件**：`src-tauri/sidecars/funasr-asr/src/main.rs`

##### 参数协议扩展

```
funasr-asr \
  --input <媒体文件> \
  --model <模型目录> \
  --model-type <sense_voice|paraformer|whisper|moonshine|telespeech_ctc|zipformer_ctc|nemo_transducer|fire_red_asr> \
  --recognizer-config <JSON 字符串> \
  --vad-model <silero_vad.onnx 路径> \
  --language <zh|en|auto|...> \
  --output-json
```

- `--recognizer-config`：Tauri command 把 manifest 中该模型的 `recognizer_config` 对象序列化为 JSON 字符串传入，sidecar 端 `serde_json::from_str` 解析。
- `--vad-model`：silero_vad.onnx 路径，必填。

##### 新增 recognizer_config 类型

```rust
#[derive(Deserialize)]
struct RecognizerConfig {
    model_type: String,
    tokens: String,
    // sense_voice
    sense_voice_model: Option<String>,
    // paraformer
    paraformer_model: Option<String>,
    // whisper
    whisper_encoder: Option<String>,
    whisper_decoder: Option<String>,
    // moonshine
    moonshine_preprocessor: Option<String>,
    moonshine_encoder: Option<String>,
    moonshine_uncached_decoder: Option<String>,
    moonshine_cached_decoder: Option<String>,
    // telespeech_ctc / zipformer_ctc
    telespeech_ctc_model: Option<String>,
    zipformer_ctc_model: Option<String>,
    // nemo_transducer
    encoder: Option<String>,
    decoder: Option<String>,
    joiner: Option<String>,
    // fire_red_asr
    fire_red_asr_encoder: Option<String>,
    fire_red_asr_decoder: Option<String>,
    // 通用
    language: Option<String>,
    use_itn: Option<bool>,
    task: Option<String>,    // "transcribe" | "translate"
    sample_rate: Option<i32>,
    feature_dim: Option<i32>,
    num_threads: Option<i32>,
}
```

##### 模型构建分发

`build_recognizer(config: &RecognizerConfig, model_dir: &Path) -> Result<OfflineRecognizer, String>` 按 `model_type` 分发到对应 sherpa-onnx Config：

| model_type | sherpa-onnx 类型 | 关键字段 |
|------------|----------------|---------|
| sense_voice | `OfflineSenseVoiceModelConfig` | sense_voice_model, language, use_itn |
| paraformer | `OfflineParaformerModelConfig` | paraformer_model |
| whisper | `OfflineWhisperModelConfig` | whisper_encoder, whisper_decoder, language, task |
| moonshine | `OfflineMoonshineModelConfig` | moonshine_preprocessor, moonshine_encoder, moonshine_uncached_decoder, moonshine_cached_decoder |
| telespeech_ctc | `OfflineTelespeechModelConfig` | telespeech_ctc_model |
| zipformer_ctc | `OfflineZipformerCtcModelConfig` | zipformer_ctc_model |
| nemo_transducer | `OfflineTransducerModelConfig` | encoder, decoder, joiner |
| fire_red_asr | `OfflineFireRedAsrModelConfig` | fire_red_asr_encoder, fire_red_asr_decoder |

所有字段值都是 `model_dir.join(path)` 解析后的绝对路径。

`OfflineRecognizerConfig.model_config.num_threads` 从 `config.num_threads` 读，默认 2；`provider` 保持 "cpu"。

##### VAD 分段识别流程

替换现有 `recognize` 函数的整段识别逻辑：

```rust
fn recognize_with_vad(
    recognizer: &OfflineRecognizer,
    vad_model_path: &Path,
    wav_path: &Path,
    config: &RecognizerConfig,
) -> Result<RecognitionOutput, String> {
    // 1. 加载 VAD
    let mut vad_config = VadModelConfig::default();
    vad_config.silero_vad = Some(vad_model_path.to_string_lossy().to_string());
    vad_config.sample_rate = config.sample_rate.unwrap_or(16000);
    vad_config.threshold = 0.5;
    vad_config.min_silence_duration_ms = 500;
    vad_config.speech_pad_ms = 100;
    let vad_model = VadModel::create(&vad_config)
        .ok_or_else(|| "创建 silero VAD 模型失败".to_string())?;

    // 2. 读取 WAV samples
    let wave = Wave::read(wav_path_str)?;
    let samples = wave.samples();
    let sample_rate = wave.sample_rate();

    // 3. VAD 分段（sherpa-onnx 提供 speech_segment_samples + speech_segment_timestamps 接口）
    let segments = compute_speech_segments(&vad_model, samples, sample_rate);

    // 4. 每段独立识别
    let mut chunks = Vec::new();
    let mut full_text = String::new();
    for (idx, seg) in segments.iter().enumerate() {
        let mut stream = recognizer.create_stream();
        stream.accept_waveform(sample_rate, &seg.samples);
        recognizer.decode(&stream);
        if let Some(result) = stream.get_result() {
            let text = result.text.trim().to_string();
            if !text.is_empty() {
                chunks.push(SubtitleChunk {
                    id: format!("chunk-{}", idx + 1),
                    text: text.clone(),
                    start: seg.start,
                    end: seg.end,
                });
                full_text.push_str(&text);
            }
        }
    }

    // 5. 兜底：若 VAD 未切出任何段（静音/失败），回退为整段识别一次
    if chunks.is_empty() {
        let mut stream = recognizer.create_stream();
        stream.accept_waveform(sample_rate, samples);
        recognizer.decode(&stream);
        if let Some(result) = stream.get_result() {
            let text = result.text.trim().to_string();
            if !text.is_empty() {
                chunks.push(SubtitleChunk {
                    id: "chunk-1".into(),
                    text: text.clone(),
                    start: 0.0,
                    end: samples.len() as f64 / sample_rate as f64,
                });
                full_text = text;
            }
        }
    }

    Ok(RecognitionOutput {
        text: full_text,
        duration: samples.len() as f64 / sample_rate as f64,
        chunks,
    })
}
```

##### 删除伪造时间戳

删除 `split_text_to_chunks`、`push_subtitle_piece` 两个函数。chunk 时间戳完全由 VAD 段提供。

#### 3.3 validate_args 改造

`validate_args` 不再硬编码要求 `model.int8.onnx` + `tokens.txt`，改为：
- 校验 `--input` 是文件
- 校验 `--model` 是目录
- 校验 `--vad-model` 文件存在
- 校验 `recognizer_config` 中声明的所有路径（`tokens` + 各模型特定字段）在 `model_dir` 下都存在

### 阶段 4：Tauri command 串联

#### 4.1 transcribe_with_funasr 扩展

**文件**：`src-tauri/src/commands/asr.rs`

```rust
#[tauri::command]
pub async fn transcribe_with_funasr(
    app: AppHandle,
    input_path: String,
    language: Option<String>,
    model_id: Option<String>,
) -> Result<TranscriptResult, String> {
    let active_model_id = model_id.unwrap_or_else(|| "sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17".to_string());

    let manifest = model_manifest::load_manifest(&app)?;
    let model = model_manifest::find_model(manifest, &active_model_id)
        .ok_or_else(|| format!("模型 {} 不在 manifest 中", active_model_id))?;
    if !model.enabled {
        return Err(format!("模型 {} 已被禁用", active_model_id));
    }

    let model_dir = crate::commands::model::find_model_dir(&app, &active_model_id)?;
    let binary = sidecar_path(&app)?;

    // VAD 路径（必填，manifest 中 required_shared_asset_ids 含 silero-vad）
    let vad_path = crate::commands::model::find_shared_asset_path(&app, "silero-vad")?;

    let recognizer_config_json = serde_json::to_string(&model.recognizer_config)
        .map_err(|e| format!("序列化 recognizer_config 失败: {e}"))?;

    let lang = language.unwrap_or_else(|| "zh".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new(&binary)
            .arg("--input").arg(&input_path)
            .arg("--model").arg(model_dir.to_str().unwrap_or(""))
            .arg("--model-type").arg(&model.family)
            .arg("--recognizer-config").arg(&recognizer_config_json)
            .arg("--vad-model").arg(vad_path.to_str().unwrap_or(""))
            .arg("--language").arg(&lang)
            .arg("--output-json")
            .output()
            .map_err(|e| format!("Failed to execute FunASR sidecar: {e}"))?;
        // ... 现有 stdout 解析逻辑保留
    }).await
}
```

#### 4.2 validate_model_dir 改造

**文件**：`src-tauri/src/commands/asr.rs`

`validate_model_dir` 删除硬编码 `required_model_files`，改为从 manifest 读取该模型的 `files` 列表并逐个校验存在性。

#### 4.3 command 注册

**文件**：`src-tauri/src/lib.rs`

在 `invoke_handler` 中追加：
- `list_shared_assets`
- `download_shared_asset`
- `check_shared_asset_downloaded`
- `download_all_models_and_assets`

### 阶段 5：前端 UI 扩展

#### 5.1 删除硬编码 MODEL_NAMES

**文件**：`src/components/ProcessingPanel/ASRSettingsPanel.tsx`

- 删除 `MODEL_NAMES` 常量（行 20-23）
- 模型下拉改为：调用 `list_available_models` 拉取全量，过滤出 `downloadedModels` 中已下载的，显示 `model.name`，加 `recommended` 时显示徽标
- 增加 family 分组（`<SelectGroup>` + `<SelectLabel>`）按 sense_voice / paraformer / whisper / 其他 分组

#### 5.2 删除旧版硬编码 SelectItem

**文件**：`src/components/ProcessingPanel/ASRPanel.tsx`

- 行 382-394 的 `<SelectItem value="sensevoice-small-int8">` / `<SelectItem value="paraformer-small-int8">` 改为动态渲染（与 ASRSettingsPanel 共用一份渲染逻辑，可抽到 `src/components/ASR/ModelSelectItems.tsx` 公共组件）

#### 5.3 ModelDownloadPanel 按 family 分组 + recommended 标记

**文件**：`src/components/ASR/ModelDownloadPanel.tsx`

- `models.map` 改为先按 family 分组，每组渲染一个 section + 标题（如 "SenseVoice 多语种"、"Paraformer 中文优先"、"Whisper 英文/多语种"、"其他"）
- 每个模型卡片：名称前若 `recommended=true` 显示 `<Badge variant="default">推荐</Badge>`
- 新增 "共享资源" section：渲染 `list_shared_assets` 返回的 silero-vad，提供下载按钮（必须在模型下载前先下载 VAD，否则识别会失败）
- 一键下载按钮改调 `download_all_models_and_assets`

#### 5.4 useASR hook 默认 model_id

**文件**：`src/hooks/useASR.ts`

默认值从 `'sensevoice-small-int8'` 改为 `'sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17'`（manifest 中的新 id），其他模型 id 也需要在用户选择时透传给 invoke。

## Assumptions & Decisions

1. **manifest 缓存策略**：用 `OnceLock<ModelManifest>` 在 Tauri 启动时加载一次，运行时只读访问，不热重载。修改 models.json 需要重启应用。
2. **region 优先级**：用户位于国内时优先 cn 镜像（modelscope_mirror / hf_mirror），失败再尝试 global。本轮先用 "cn 在前 global 在后" 的固定顺序，后续可加 IP 地理探测。
3. **不内置模型**：删除 `tauri.conf.json::resources` 中的 `models/sensevoice/*`，所有模型走 `app_data_dir` 用户下载。`binaries/*` 保留（sidecar 仍随 app 打包）。
4. **不重构进度回调为流式**：本轮 `transcribe_with_funasr` 仍用 `Command::output()` 一次性等待。VAD 分段会让长音频识别更慢，但前端文案改为 "正在使用 VAD 分段识别，长音频可能需要较长时间..."。流式进度作为下一阶段独立任务。
5. **recognizer_config 用 `serde_json::Value` 透传**：不在 Rust 类型层为 8 个 family 各写一份 struct，sidecar 端按 `model_type` 反序列化。这样 manifest 新增 family 只需扩 sidecar 解析逻辑，不动 Rust command 层。
6. **VAD 参数固定**：threshold=0.5, min_silence_duration_ms=500, speech_pad_ms=100, max_speech_duration_s 不限。这些值作为合理默认，UI 暴露调参作为后续任务。
7. **大小校验放宽**：models.json 的 `sha256` 全部为 `null`，无法精确校验。`check_model_downloaded` 改为只校验文件存在，不强校验大小。下载完成后由解压流程保证文件完整性。
8. **删除旧 id 兼容**：`find_model_dir` 中的 `sensevoice-small-int8` 旧版目录兼容分支删除。用户之前下载到 `app_data_dir/models/sensevoice-small-int8/` 的模型在新 id 体系下需要重新下载（`sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17`）。这是破坏性变更，需在升级说明里写明。
9. **whisper task 字段**：manifest 中 whisper 模型 `task: "transcribe"`，sidecar 解析后传给 `OfflineWhisperModelConfig.task`，不支持 `translate`（manifest 中也无该需求）。
10. **nemo_transducer num_threads=4**：manifest 中 parakeet 与 fire_red_asr 显式标注 `num_threads: 4`，sidecar 从 recognizer_config 读取并应用。

## Verification Steps

每个阶段完成后运行：

### 阶段 1 验证（manifest 加载）
- `cargo check --manifest-path src-tauri/Cargo.toml`
- 启动 app，前端 `list_available_models` 返回 22 个模型 + 1 个 shared_asset
- `check_model_downloaded` 对未下载模型返回 `None`

### 阶段 2 验证（下载+解压）
- `cargo check --manifest-path src-tauri/Cargo.toml`
- 前端触发 `download_shared_asset('silero-vad')`，确认 `app_data_dir/shared_assets/silero-vad/silero_vad.onnx` 存在
- 前端触发 `download_model('sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17')`，确认归档下载并解压到 `app_data_dir/models/<id>/`，包含 `model.int8.onnx` + `tokens.txt`
- 重复触发 `download_model`，确认断点续传与跳过已完成文件逻辑生效
- 测试一个 whisper 模型下载，确认 5 个文件（encoder.onnx / decoder.onnx / int8 encoder/decoder / tokens）全部解压

### 阶段 3 验证（sidecar）
- `pnpm build:funasr-sidecar`（确认 sherpa-onnx vad feature 编译通过）
- 手动调用 sidecar：
  ```bash
  ./src-tauri/binaries/funasr-asr \
    --input test.wav \
    --model <model_dir> \
    --model-type sense_voice \
    --recognizer-config '{"model_type":"sense_voice","sense_voice_model":"model.int8.onnx","tokens":"tokens.txt","language":"auto","use_itn":true,"sample_rate":16000,"feature_dim":80,"num_threads":2}' \
    --vad-model <silero_vad.onnx 路径> \
    --language zh \
    --output-json
  ```
- 对 8 个 family 各跑一个模型，确认 stdout 返回合法 JSON，chunks 时间戳为 VAD 真实分段（非字数比例）
- 确认长音频（>30 秒）被切成多段，每段时间戳连续递增

### 阶段 4 验证（command 串联）
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `pnpm tsc -b --noEmit`
- Tauri 端通过 `invoke('transcribe_with_funasr', { inputPath, language, modelId })` 调用，确认 22 个模型中至少 sense_voice / paraformer / whisper-tiny / moonshine / fire_red_asr 各跑通一个样例

### 阶段 5 验证（前端 UI）
- `pnpm tsc -b --noEmit`
- `pnpm lint`
- `pnpm tauri dev` 启动应用
- ModelDownloadPanel：22 个模型按 family 分组显示，`recommended=true` 的模型（sensevoice-small-int8 / paraformer-zh-int8-2023-09-14）显示 "推荐" 徽标
- silero-vad 出现在 "共享资源" section，可独立下载
- ASRSettingsPanel 模型下拉：按 family 分组 `<SelectGroup>`，仅展示已下载模型
- 端到端：下载 sensevoice → 下载 silero-vad → 选择视频 → 识别 → 字幕出现在编辑器，时间戳为真实分段

### 最终回归
- `pnpm build:funasr-sidecar && cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc -b --noEmit`（AGENTS.md 要求的验证链路）
- 切换 ASR 引擎为 transformers，确认 Whisper 浏览器本地路径未被破坏
