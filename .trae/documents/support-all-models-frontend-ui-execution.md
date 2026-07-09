# 支持 models.json 全部模型：前端 UI 执行计划（阶段 5）

## Summary

本计划是 `.trae/documents/support-all-models-remaining-stages.md` 的收尾续作。前序会话已完成 **阶段 1-4**（manifest 加载、归档下载+解压、sidecar main.rs 支持 8 family + VAD、asr.rs 串联传 `--model-type`/`--recognizer-config`/`--vad-model`），后端编译已通过。本计划仅覆盖**阶段 5 前端 UI 扩展**与最终回归：

- 5.1 `appStore.ts` 默认 `asrModelId` 切到 `DEFAULT_MODEL_ID`
- 5.2 新建 `src/components/ASR/ModelSelectItems.tsx` 公共下拉组件
- 5.3 `ASRSettingsPanel.tsx` 删除硬编码 `MODEL_NAMES`，改为动态渲染 + 按 family 分组
- 5.4 `ASRPanel.tsx` 删除硬编码 2 个 SelectItem，改用公共组件
- 5.5 `ModelDownloadPanel.tsx` 修复失效的 command 调用 + 新增 silero-vad 共享资源区 + 模型按 family 分组 + 推荐徽标
- 最终回归：`pnpm build:funasr-sidecar && cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc -b --noEmit && pnpm lint`

## Current State Analysis（Phase 1 探索结果）

### 已完成（后端，无需再改）

| 文件 | 已完成内容 |
|------|-----------|
| [src-tauri/sidecars/funasr-asr/src/main.rs](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src-tauri/sidecars/funasr-asr/src/main.rs) | 支持 8 family + VAD 分段识别，`pnpm build:funasr-sidecar` 通过 |
| [src-tauri/src/commands/asr.rs](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src-tauri/src/commands/asr.rs) | `transcribe_with_funasr` 从 manifest 读 family + recognizer_config + silero-vad 路径传给 sidecar；`check_funasr_environment` 用 `DEFAULT_MODEL_ID` 常量；`validate_model_dir(model_dir, model: &ManifestModel)` 遍历 `model.files` |
| [src-tauri/src/commands/model.rs](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src-tauri/src/commands/model.rs) | 提供 `list_available_models` / `list_shared_assets` / `download_model` / `download_shared_asset` / `download_all_models_and_assets` / `check_shared_asset_downloaded` / `find_shared_asset_path` |
| [src-tauri/src/lib.rs](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src-tauri/src/lib.rs) | 已注册全部新 commands |
| [src/types/model.ts](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/types/model.ts) | `AvailableModel` / `RecognizerConfig` / `SharedAssetDto` / `ArtifactDto` / `MODEL_FAMILY_LABELS` / `DEFAULT_MODEL_ID = 'sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17'` 全部已定义 |

### 未完成（本计划目标）

| 文件 | 行号 | 当前状态 | 问题 |
|------|------|---------|------|
| [src/stores/appStore.ts](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/stores/appStore.ts#L135) | 135 | `asrModelId: 'sensevoice-small-int8'` | 旧 id 不在 manifest 中，`check_funasr_environment` 会报"模型不在 manifest 中" |
| [src/components/ProcessingPanel/ASRSettingsPanel.tsx](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/components/ProcessingPanel/ASRSettingsPanel.tsx#L19-L23) | 19-23, 218-222 | 硬编码 `MODEL_NAMES` 2 条映射；只渲染 `downloadedModels: string[]`（无 family 分组、无 recommended 徽标、无完整 model 信息） | 新增模型需手改前端；22 个模型挤在一个平铺列表 |
| [src/components/ProcessingPanel/ASRPanel.tsx](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/components/ProcessingPanel/ASRPanel.tsx#L382-L394) | 382-394, 206-210 | 硬编码 2 个 `<SelectItem>`（`sensevoice-small-int8` / `paraformer-small-int8`，均不存在于 manifest）；`changeModel` toast 文案按 id 硬编码 | 选其他模型不可用；文案会显示原始 id |
| [src/components/ASR/ModelDownloadPanel.tsx](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/components/ASR/ModelDownloadPanel.tsx#L94) | 94, 237-262 | 调 `invoke('download_all_models')`（**该 command 已不存在**，点击会报错）；无 shared_assets section；模型平铺未按 family 分组；无 recommended 徽标；`formatSize(model.size_bytes)` 字段不存在（`AvailableModel` 无 `size_bytes` 字段，应用 `artifact.size_mb_estimate`） | silero-vad 无法独立下载；22 个模型挤一坨；推荐的模型无视觉突出；类型错误 |

### 关键依赖确认（Phase 1 已验证）

1. **`SelectGroup` / `SelectLabel` 已导出**：[src/components/ui/select.tsx](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/components/ui/select.tsx) 行 13、86、175、177，可直接 `import { SelectGroup, SelectLabel } from '@/components/ui/select'`
2. **`badge.tsx` 不存在**：[src/components/ui/](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/components/ui/) 下无 badge 组件。推荐徽标用内联 `<span>` + Tailwind 样式实现，不引入新 shadcn 组件（遵循"NEVER create files unless necessary"原则）
3. **[src/components/ASR/index.ts](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/components/ASR/index.ts)** 只导出 `ASRLanguageSelector` 和 `ModelDownloadPanel`；新建 `ModelSelectItems.tsx` 后需在此文件追加 export
4. **`asr.rs` 后端默认 id 已是 `DEFAULT_MODEL_ID`**：[src-tauri/src/commands/asr.rs:8](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src-tauri/src/commands/asr.rs#L8) `const DEFAULT_MODEL_ID: &str = "sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17";`，前端只需对齐
5. **`AvailableModel` 接口字段**：含 `id` / `name` / `family` / `recommended` / `description` / `artifact.size_mb_estimate` / `files` / `download_sources`，无 `size_bytes`（ModelDownloadPanel 行 258 `model.size_bytes` 是类型错误）

## Proposed Changes

### 5.1 appStore.ts：默认 model_id 对齐 manifest

**文件**：[src/stores/appStore.ts](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/stores/appStore.ts)

**改动**：
1. 顶部 import 区追加：`import { DEFAULT_MODEL_ID } from '@/types/model';`
2. 行 135 `asrModelId: 'sensevoice-small-int8',` → `asrModelId: DEFAULT_MODEL_ID,`

**注意**：`persist` 中间件会把旧 `asrModelId: 'sensevoice-small-int8'` 持久化到 localStorage。用户升级后，store 仍会读到旧值。为避免此问题，在 store 初始化时做一次兼容迁移：如果 `asrModelId === 'sensevoice-small-int8'` 或 `'paraformer-small-int8'`，覆盖为 `DEFAULT_MODEL_ID`。具体做法：在 `persist` 的 `merge` 选项里加迁移逻辑，或在 `initialize()` action 里检查并修正。本轮采用最小改动：在 `initialState` 改默认值 + 在 `initialize()` 中加一行兼容修正（因为 `initialize` 已存在）。

```typescript
// initialize action 内追加：
initialize: async () => {
  set((state) => {
    const legacyIds = ['sensevoice-small-int8', 'paraformer-small-int8'];
    const asrModelId = legacyIds.includes(state.asrModelId) ? DEFAULT_MODEL_ID : state.asrModelId;
    return { ...state, asrModelId };
  });
},
```

### 5.2 新建 ModelSelectItems.tsx 公共下拉组件

**新文件**：`src/components/ASR/ModelSelectItems.tsx`

**职责**：渲染按 family 分组的已下载模型 `<SelectItem>` 列表，供 `ASRSettingsPanel` 与 `ASRPanel` 共用。仅渲染 `<SelectGroup>` + `<SelectItem>`，外层 `<SelectContent>` 由调用方提供。

**Props**：
```typescript
interface ModelSelectItemsProps {
  /** 全部 manifest 模型（来自 list_available_models） */
  allModels: AvailableModel[];
  /** 已下载的模型 id 集合（来自 check_all_models_downloaded） */
  downloadedModelIds: string[];
}
```

**渲染逻辑**：
1. 按 `MODEL_FAMILY_LABELS` 的 key 顺序遍历 family（保证顺序稳定：sense_voice → paraformer → whisper → moonshine → telespeech_ctc → zipformer_ctc → nemo_transducer → fire_red_asr）
2. 每个 family 过滤出 `allModels.filter(m => m.family === family && downloadedModelIds.includes(m.id))`
3. 跳过没有已下载模型的 family
4. 每组渲染 `<SelectGroup>` + `<SelectLabel>{MODEL_FAMILY_LABELS[family]}</SelectLabel>` + 该组所有模型的 `<SelectItem>`
5. 每个 `<SelectItem value={model.id}>` 显示：`{model.name}` + 若 `model.recommended` 追加 ` <span className="...">推荐</span>`

**示例**：
```tsx
import { SelectGroup, SelectItem, SelectLabel } from '@/components/ui/select';
import type { AvailableModel } from '@/types/model';
import { MODEL_FAMILY_LABELS } from '@/types/model';

interface ModelSelectItemsProps {
  allModels: AvailableModel[];
  downloadedModelIds: string[];
}

export function ModelSelectItems({ allModels, downloadedModelIds }: ModelSelectItemsProps) {
  const families = Object.keys(MODEL_FAMILY_LABELS);
  return (
    <>
      {families.map((family) => {
        const models = allModels.filter(
          (m) => m.family === family && downloadedModelIds.includes(m.id),
        );
        if (models.length === 0) return null;
        return (
          <SelectGroup key={family}>
            <SelectLabel>{MODEL_FAMILY_LABELS[family]}</SelectLabel>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="flex items-center gap-1.5">
                  <span>{m.name}</span>
                  {m.recommended && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      推荐
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        );
      })}
    </>
  );
}
```

**追加 export**：在 [src/components/ASR/index.ts](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/components/ASR/index.ts) 追加 `export { ModelSelectItems } from './ModelSelectItems';`

### 5.3 ASRSettingsPanel.tsx：动态渲染 + family 分组

**文件**：[src/components/ProcessingPanel/ASRSettingsPanel.tsx](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/components/ProcessingPanel/ASRSettingsPanel.tsx)

**改动**：
1. **删除 `MODEL_NAMES` 常量**（行 19-23）
2. import 区追加：
   ```typescript
   import { ModelSelectItems } from '@/components/ASR';
   import type { AvailableModel } from '@/types/model';
   ```
3. 新增 state：`const [allModels, setAllModels] = useState<AvailableModel[]>([]);`
4. 在两个 `useEffect`（初始加载 + 窗口聚焦刷新）里，于 `check_all_models_downloaded` 之外追加 `invoke<AvailableModel[]>('list_available_models')` 并 `setAllModels(list)`。错误时 `console.error` 但不阻塞
5. `changeModel` 回调中：`const modelName = MODEL_NAMES[modelId] || modelId;` → `const modelName = allModels.find(m => m.id === modelId)?.name || modelId;`
6. 模型下拉的 `<SelectContent>` 内容（行 217-223）替换：
   ```tsx
   <SelectContent>
     <ModelSelectItems
       allModels={allModels}
       downloadedModelIds={downloadedModels}
     />
   </SelectContent>
   ```

**保留**：现有"未下载模型"提示卡片（行 225-239）逻辑不变。

### 5.4 ASRPanel.tsx：删除硬编码 SelectItem

**文件**：[src/components/ProcessingPanel/ASRPanel.tsx](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/components/ProcessingPanel/ASRPanel.tsx)

**改动**：
1. import 区追加：
   ```typescript
   import { ModelSelectItems } from '@/components/ASR';
   import type { AvailableModel, AllModelsStatus } from '@/types/model';
   ```
2. 新增 state：
   ```typescript
   const [allModels, setAllModels] = useState<AvailableModel[]>([]);
   const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
   const [isTauri, setIsTauri] = useState(false);
   ```
3. 新增 `useEffect`：检测 `__TAURI_INTERNALS__`，调 `list_available_models` + `check_all_models_downloaded`；窗口聚焦时刷新（与 ASRSettingsPanel 同模式）
4. **行 382-394 的 `<SelectContent>` 内容替换**：
   ```tsx
   <SelectContent>
     {downloadedModels.length > 0 ? (
       <ModelSelectItems
         allModels={allModels}
         downloadedModelIds={downloadedModels}
       />
     ) : (
       <SelectItem value={asrModelId} disabled>
         未下载模型，请到设置中下载
       </SelectItem>
     )}
   </SelectContent>
   ```
5. `changeModel` 回调（行 206-210）：toast 文案改为查 `allModels.find(m => m.id === modelId)?.name || modelId`
6. `Select` 的 `value` 改为 `downloadedModels.includes(asrModelId) ? asrModelId : (downloadedModels[0] ?? asrModelId)`，确保即使当前选中的模型未下载也能显示第一个已下载模型
7. **保留**：行 399-413 的提示文案（FunASR Tauri 说明）可保留，但将"支持 SenseVoice / Paraformer 多语种模型"改为"支持 8 种 model family，详见下载面板"

### 5.5 ModelDownloadPanel.tsx：修复 command + 共享资源 + family 分组 + 推荐徽标

**文件**：[src/components/ASR/ModelDownloadPanel.tsx](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/components/ASR/ModelDownloadPanel.tsx)

**改动**：

#### 5.5.1 修复失效 command 调用
- 行 94 `invoke<AllModelsStatus>('download_all_models')` → `invoke<AllModelsStatus>('download_all_models_and_assets')`

#### 5.5.2 修复类型错误
- 行 258 `formatSize(model.size_bytes)` → `model.artifact.size_mb_estimate ? formatSize(model.artifact.size_mb_estimate * 1_000_000) : '未知大小'`

#### 5.5.3 新增 sharedAssets state 与加载逻辑
```typescript
import type { AvailableModel, ModelDownloadProgress, AllModelsStatus, SharedAssetDto } from '@/types/model';
import { MODEL_FAMILY_LABELS } from '@/types/model';

// state
const [sharedAssets, setSharedAssets] = useState<SharedAssetDto[]>([]);
const [sharedAssetDownloaded, setSharedAssetDownloaded] = useState<Record<string, boolean>>({});
const [sharedAssetProgress, setSharedAssetProgress] = useState<ModelDownloadProgress | null>(null);

// loadStatus 内追加：
const assets = await invoke<SharedAssetDto[]>('list_shared_assets');
setSharedAssets(assets);
const assetStatus: Record<string, boolean> = {};
for (const a of assets) {
  const dir = await invoke<string | null>('check_shared_asset_downloaded', { assetId: a.id });
  assetStatus[a.id] = dir !== null;
}
setSharedAssetDownloaded(assetStatus);
```

#### 5.5.4 进度事件区分模型与共享资源
现有 `model-download-progress` 监听（行 70-82）扩展：
```typescript
listen<ModelDownloadProgress>('model-download-progress', (event) => {
  const p = event.payload;
  // silero-vad 的 model_id 是 'silero-vad'（shared asset）
  if (sharedAssets.some(a => a.id === p.model_id)) {
    setSharedAssetProgress(p);
    if (p.status === 'complete') {
      setDownloadingType(null);
      setError(null);
      loadStatus();
    }
    if (p.status === 'error') {
      setDownloadingType(null);
      setError(p.error || '下载失败');
    }
    return;
  }
  // 模型进度走原有逻辑
  setFunasrProgress(p);
  if (p.status === 'complete') { setDownloadingType(null); setError(null); loadStatus(); }
  if (p.status === 'error') { setDownloadingType(null); setError(p.error || '下载失败'); }
});
```

#### 5.5.5 新增"共享资源"section
在 Whisper section 与 FunASR section 之间插入：
```tsx
{isTauri && sharedAssets.length > 0 && (
  <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
    <div className="flex items-center space-x-2">
      <Package className="h-4 w-4 text-blue-500" />
      <h4 className="text-sm font-medium">共享资源 (VAD)</h4>
    </div>
    <p className="text-xs text-muted-foreground">
      所有模型生成字幕时必需的 VAD 模型，用于把长音频切成语音片段。
    </p>
    {sharedAssets.map((asset) => {
      const isReady = sharedAssetDownloaded[asset.id] ?? false;
      const isDownloading = downloadingType === `asset-${asset.id}`;
      const onClick = async () => {
        setDownloadingType(`asset-${asset.id}`);
        setError(null);
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('download_shared_asset', { assetId: asset.id });
        } catch (err) {
          setDownloadingType(null);
          setError(typeof err === 'string' ? err : String(err));
        }
      };
      return (
        <div key={asset.id} className={cn(
          'flex items-center justify-between p-3 border rounded-md bg-background',
          isReady && 'border-green-300 bg-green-50 dark:bg-green-950/20',
        )}>
          <div className="flex-1 min-w-0 mr-3">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium truncate">{asset.name}</span>
              {asset.required_for_subtitle && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  必需
                </span>
              )}
              {isReady && (
                <span className="text-xs text-green-600 flex items-center shrink-0">
                  <CheckCircle2 className="h-3 w-3 mr-0.5" />
                  已下载
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{asset.description}</p>
          </div>
          {renderDownloadButton(isReady, isDownloading, onClick)}
        </div>
      );
    })}
    {/* 共享资源下载进度条（复用 funasrProgress 的渲染逻辑，但读 sharedAssetProgress） */}
    {sharedAssetProgress && downloadingType?.startsWith('asset-') && (
      <div className="space-y-2 p-3 border rounded-md bg-background">
        {/* 同 funasrProgress 进度条结构 */}
      </div>
    )}
  </div>
)}
```

#### 5.5.6 FunASR 模型按 family 分组
替换现有 `models.map((model) => ...)`（行 237-262）为按 family 分组渲染：
```tsx
{Object.entries(MODEL_FAMILY_LABELS).map(([family, label]) => {
  const familyModels = models.filter(m => m.family === family);
  if (familyModels.length === 0) return null;
  return (
    <div key={family} className="space-y-2">
      <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</h5>
      {familyModels.map((model) => {
        const isDownloaded = status?.downloaded_model_ids.includes(model.id) ?? false;
        const isDownloading = downloadingType === `model-${model.id}`;
        const onClick = async () => {
          setDownloadingType(`model-${model.id}`);
          setError(null);
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('download_model', { modelId: model.id });
          } catch (err) {
            setDownloadingType(null);
            setError(typeof err === 'string' ? err : String(err));
          }
        };
        return (
          <div key={model.id} className={cn(
            'flex items-center justify-between p-3 border rounded-md bg-background',
            isDownloaded && 'border-green-300 bg-green-50 dark:bg-green-950/20',
          )}>
            <div className="flex-1 min-w-0 mr-3">
              <div className="flex items-center space-x-2 flex-wrap">
                <span className="text-sm font-medium truncate">{model.name}</span>
                {model.recommended && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                    推荐
                  </span>
                )}
                {model.quantization && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                    {model.quantization}
                  </span>
                )}
                {isDownloaded && (
                  <span className="text-xs text-green-600 flex items-center shrink-0">
                    <CheckCircle2 className="h-3 w-3 mr-0.5" />
                    已下载
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                大小: {model.artifact.size_mb_estimate
                  ? formatSize(model.artifact.size_mb_estimate * 1_000_000)
                  : '未知'}
              </p>
            </div>
            {renderDownloadButton(isDownloaded, isDownloading, onClick)}
          </div>
        );
      })}
    </div>
  );
})}
```

#### 5.5.7 进度条区分模型与共享资源
`downloadingType === 'funasr'` 时的进度条逻辑保留（用于"一键下载全部"），但单个模型下载（`downloadingType === 'model-xxx'`）也显示进度条。简化：只要 `funasrProgress` 存在且 `downloadingType` 以 `model-` 或 `funasr` 开头就显示。

### 5.6 验证 useASR.ts 与 FunASRTauriEngine.ts（确认无需改）

**文件**：[src/hooks/useASR.ts](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/hooks/useASR.ts) 与 [src/services/asrEngines/FunASRTauriEngine.ts](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/services/asrEngines/FunASRTauriEngine.ts)

**确认事项**（Phase 1 已通过 grep 间接确认）：
- `useASR.ts` 读 store 的 `asrModelId` 透传到 `transcribe_with_funasr`，无需改
- `FunASRTauriEngine.ts` 的 `invoke('transcribe_with_funasr', { inputPath, language, modelId })` 已透传 modelId，无需改

执行时 `grep -n "asrModelId\|modelId" src/hooks/useASR.ts src/services/asrEngines/FunASRTauriEngine.ts` 二次确认即可，不写改动。

## Assumptions & Decisions

1. **推荐徽标用内联 span**：[src/components/ui/badge.tsx](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/components/ui/) 不存在，遵循"NEVER create files unless necessary"原则，用 `<span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">推荐</span>` 代替，不引入 shadcn badge 组件
2. **localStorage 兼容迁移**：用户升级前若已持久化 `asrModelId: 'sensevoice-small-int8'`，store 会读到旧值。在 `initialize()` action 中检查 legacy id 列表并覆盖为 `DEFAULT_MODEL_ID`，避免"模型不在 manifest 中"错误
3. **进度事件区分模型与共享资源**：`model-download-progress` 事件的 `model_id` 字段——模型下载时是 model id（如 `sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17`），共享资源下载时是 asset id（如 `silero-vad`）。前端通过 `sharedAssets.some(a => a.id === p.model_id)` 区分
4. **`download_shared_asset` 后端 command 签名**：参数名是 `asset_id`（Rust `asset_id: String`），前端 invoke 时用 camelCase `{ assetId: 'silero-vad' }`（Tauri 自动转换）。执行时 `grep -n "download_shared_asset" src-tauri/src/commands/model.rs` 二次确认参数名
5. **family 渲染顺序**：用 `Object.entries(MODEL_FAMILY_LABELS)` 顺序（与 [src/types/model.ts:118-127](file:///Users/zhangxiangchen/Code/demo/flycut-caption/src/types/model.ts#L118-L127) 定义顺序一致），保证 sense_voice → paraformer → whisper → ... → fire_red_asr 稳定
6. **ModelSelectItems 只渲染已下载模型**：未下载的模型在下载面板里展示，识别面板只列已下载，避免用户选了未下载模型后识别失败
7. **`asr.rs` 默认 model_id 已对齐**：后端 `DEFAULT_MODEL_ID` 常量已存在，前端 `appStore.ts` 改完即前后端一致，无需后端再改
8. **不重构进度回调为流式**：本轮仍用 `Command::output()` 一次性等待，VAD 分段会让长音频识别更慢，前端文案保持现状。流式进度作为下一阶段独立任务
9. **`useASR.ts` / `FunASRTauriEngine.ts` 不改**：已透传 modelId，仅执行时 grep 二次确认

## Verification Steps

### 阶段 5 验证（前端 UI）

```bash
# 1. TypeScript 类型检查
pnpm tsc -b --noEmit

# 2. ESLint
pnpm lint

# 3. 启动 Tauri dev
pnpm tauri dev
```

**手动验证项**：
- [ ] ModelDownloadPanel：22 个模型按 8 个 family 分组显示，每组有标题；`recommended=true` 的模型显示"推荐"徽标
- [ ] ModelDownloadPanel：silero-vad 出现在"共享资源 (VAD)"section，可独立下载，下载进度条正常
- [ ] ModelDownloadPanel：点击"下载全部"调用 `download_all_models_and_assets`（不再报错）
- [ ] ModelDownloadPanel：单个模型下载按钮调用 `download_model`，进度条正常
- [ ] ASRSettingsPanel：模型下拉按 family 分组 `<SelectGroup>`，仅展示已下载模型，推荐模型显示"推荐"
- [ ] ASRPanel：模型下拉同上，切换模型 toast 显示 model.name（不是 id）
- [ ] appStore：升级后旧的 `sensevoice-small-int8` 自动迁移到 `DEFAULT_MODEL_ID`，不报"模型不在 manifest 中"

### 最终回归（AGENTS.md 验证链路）

```bash
pnpm build:funasr-sidecar && cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc -b --noEmit && pnpm lint
```

### 端到端冒烟

```bash
pnpm tauri dev
# 1. 在 ModelDownloadPanel 下载 silero-vad + sensevoice-small-int8-zh-en-ja-ko-yue-2024-07-17
# 2. 选择一个视频文件
# 3. 引擎切到 FunASR Tauri 本地
# 4. 模型下拉应显示已下载的 sense_voice 组 + 推荐 徽标
# 5. 点击"开始生成字幕"，确认 VAD 分段识别返回字幕，时间戳为真实分段
```

切换 ASR 引擎为 transformers，确认 Whisper 浏览器本地路径未被破坏（Whisper section 仍可下载/识别）。

## 实施顺序

1. **5.1**：改 `appStore.ts`（加 import + 改默认值 + `initialize` 兼容迁移） → `pnpm tsc -b --noEmit` 确认无类型错误
2. **5.2**：新建 `ModelSelectItems.tsx` + 在 `ASR/index.ts` 追加 export → `pnpm tsc -b --noEmit`
3. **5.3**：改 `ASRSettingsPanel.tsx`（删 MODEL_NAMES、加 allModels state、用 ModelSelectItems）→ `pnpm tsc -b --noEmit`
4. **5.4**：改 `ASRPanel.tsx`（删硬编码 SelectItem、加 allModels state、用 ModelSelectItems、改 toast 文案）→ `pnpm tsc -b --noEmit`
5. **5.5**：改 `ModelDownloadPanel.tsx`（修 command、修 size_bytes 类型错误、加 sharedAssets section、family 分组、推荐徽标）→ `pnpm tsc -b --noEmit`
6. **lint**：`pnpm lint` 修复 lint 警告
7. **最终回归**：`pnpm build:funasr-sidecar && cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc -b --noEmit && pnpm lint`
8. **端到端冒烟**：`pnpm tauri dev` 跑一次完整流程
