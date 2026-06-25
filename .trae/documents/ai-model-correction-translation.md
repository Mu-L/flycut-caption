# AI 模型集成：字幕纠错与翻译 实施计划

## Summary
为 FlyCut Caption 增加「AI 模型」集成能力：用户可在设置中添加多个 OpenAI 兼容的 AI 模型（自定义 baseUrl + apiKey + model），并在字幕列表中对**全部未删除字幕**一键执行「字幕纠错」（修正主文本 `text`）与「字幕翻译」（写入副文本 `secondText`）。两种能力均基于现有的字幕 `historyStore`、Shadcn/ui 与 Zustand 模式扩展，保证撤销/重做可用、UI 风格统一。

## Current State Analysis (基于代码调研)

- **状态管理**：全局使用 Zustand。`src/stores/appStore.ts` 使用 `persist` 持久化到 `localStorage`（`name: 'app-settings'`），通过 `partialize` 选择持久字段，目前**无任何 AI/LLM 设置字段**。`src/stores/historyStore.ts` 提供字幕 `chunks` 数据与完整 undo/redo，已有 `update(id, next)` 与 `updateChunkText` 等方法，但**无批量写入 `secondText` 的便捷 action**。`src/stores/messageStore.ts` 提供 toast 反馈（`useShowSuccess` 等）。
- **字幕类型**：`src/types/subtitle.ts` 中 `SubtitleChunk` 已含 `text`、`secondText?('副字幕文本，双语用')`、`timestamp`、`id`，直接契合翻译写入需求。
- **字幕编辑**：`src/components/SubtitleEditor/SubtitleItem.tsx` 已支持 `Main|Second|Bilingual` 三种显示模式（来自 `appStore.display`），副字幕输入框在 `Second/Bilingual` 模式下已渲染。`SubtitleList.tsx` 头部右侧已预留了「翻译语言下拉 + 开始按钮」UI，但**完全 disabled 且无 `onValueChange`/无逻辑**。
- **服务层模式**：`src/services/asrService.ts` 是「单例 + 引擎抽象 + `setProgressCallback`」模式示例（导出全局 `asrService`），新 AI 服务**直接仿照**该模式即可。目前**无任何外部 LLM 调用代码**。
- **Hook 编排模式**：`src/hooks/useASR.ts` 调用 `asrService` → 写入 `historyStore.setTranscript` + `appStore.setASRProgress` + 反馈，可作为 `useAI` hook 的参考。
- **Tab / 设置面板**：`src/FlyCutCaption.tsx` 下方 Tab 体系含 `style | tools | options | api`，其中 `api` Tab 为「外部 ASR API、在线硬字幕、视频转码」占位（无具体 UI）。工具 Tab 已列 `aiTranslationTitle` 文案占位。设置弹窗 `SettingsDialog.tsx` 当前只用于模型下载。
- **i18n**：`src/contexts/LocaleProvider.tsx` + `useTranslation()`；语言包 `src/locales/zh_CN.ts`/`en_US.ts`，类型 `src/locales/types.ts`。已有 `aiTranslationTitle`、`translateSubtitle`、`subtitleTranslated` 等占位文案，需补齐 AI 设置/纠错相关 key。
- **UI 组件库**：`src/components/ui/` 提供 `dialog/select/input/label/button/switch` 等，可复用。

## Assumptions & Decisions
1. **Provider 范围**：仅对接 OpenAI 兼容 `/v1/chat/completions`（覆盖 OpenAI、DeepSeek、Moonshot、OpenRouter、本地 Ollama 等），用户填写 baseUrl+apiKey+model。
2. **处理范围**：纠错/翻译对**所有未删除字幕**批量处理，整批作为一次 undo 操作。不做「仅处理选中」模式。
3. **API Key 存储**：V1 直接随 `appStore` 持久化到 `localStorage`（由 Zustand persist 完成）。**安全说明**：明文存储于浏览器本地，仅适合本地工具场景；后续可升级加密。计划中在 UI 加最低限度的"本地存储"提示文案。
4. **进度反馈**：复用 `ASRProgress` 风格结构新增 `AIProgress`（`status: 'running'|'complete'|'error'`、`progress`、`error`、`data`）。翻译/纠错按行数估算进度。
5. **LLM 返回对齐**：要求模型按「输入 N 行，输出 N 行 JSON 数组 `[{id,text}]`」格式返回；若行数不一致则报错并保留原文，不破坏时间戳。
6. **批量 Undo**：在 `historyStore` 新增 `batchUpdateText(updates)` action，将整批写入折叠为单条 undo 记录（设置 `lastUpdateTime` 让后续连续 AI 调用不被误合并）。
7. **并发与流式**：V1 不做流式（SSE），使用一次性 `chat/completions` 请求；超长字幕按固定条数（如 50 条）分片串行请求，每片完成更新进度。
8. **兜底 Provider 字段**：模型表单提供 `name`（别名展示）、`baseUrl`、`apiKey`、`model`、`temperature?` 字段。

## Proposed Changes

### 1) 类型定义 — 新增 `src/types/ai.ts`
- 导出 `AIModelConfig`: `{ id: string; name: string; baseUrl: string; apiKey: string; model: string; temperature?: number }`。
- 导出 `AIProgress`: 复用 `ASRProgress` 字段命名风格 `{ status: 'running'|'complete'|'error'; progress?: number; data?: string; error?: string }`。
- 导出 `AITaskType = 'correction' | 'translation'`。
- 导出 `AIRequestOptions`: `{ model: AIModelConfig; targetLang?: string }`。
- 在 `src/types/index.ts`（如存在）或直接在使用处 import，不强行集中导出。

### 2) 状态存储 — 扩展 `src/stores/appStore.ts`
- `AppState` 新增：`aiModels: AIModelConfig[]`、`aiProgress: AIProgress | null`、`selectedAIModelId: AIModelConfig['id'] | null`。
- `AppActions` 新增：`addAIModel(model)`、`updateAIModel(id, patch)`、`removeAIModel(id)`、`setSelectedAIModelId(id)`、`setAIProgress(p)`、`clearAIProgress()`。
- `initialState.aiModels = []`、`aiProgress = null`、`selectedAIModelId = null`。
- 在 `partialize` 中加入 `aiModels`、`selectedAIModelId`（**含 apiKey**，按 Decision #3 明文持久化）。**不要** 持久化 `aiProgress`（运行态）。
- 新增 setter 实现遵循现有 `set((state) => ({...}))` 风格。`addAIModel` 使用 `crypto.randomUUID()` 生成 id。

### 3) 历史存储 — 扩展 `src/stores/historyStore.ts`
- 新增 action `batchUpdateText(updates: { id: string; text?: string; secondText?: string }[])`：将多个 chunk 的 text/secondText 合并写入，生成**单条** `UpdateAction`（`prev`/`next` 为各 chunk 的差异合集），便于一次性 undo。重算衍生状态。新增导出 `useBatchUpdateText`。
- 不改动现有 `update`/`updateChunkText` 逻辑，避免影响行内编辑合并行为。

### 4) AI 服务层 — 新增 `src/services/aiService.ts` + `src/services/aiEngines/OpenAICompatibleEngine.ts`
- `OpenAICompatibleEngine`：
  - `setProgressCallback(cb)`、私有 `progress` 上报方法。
  - `async correct(items: { id: string; text }[], model: AIModelConfig): Promise<{id;text}[]>`：构造纠错 system prompt（"修正 ASR 字幕错别字、标点、口语化冗词，保持行数与顺序，返回 JSON 数组 [{id,text}]"），按固定条数分片串行调用 `POST {baseUrl}/chat/completions`，解析 `choices[0].message.content`，校验行数一致，否则抛错。
  - `async translate(items: { id; text }[], model, targetLang): Promise<{id;text}[]>`：翻译 prompt（"将每行翻译为 {targetLang}，保留 id，返回 JSON 数组 [{id,text}]"），同样分片。
  - 请求用原生 `fetch`；headers `Authorization: Bearer ${apiKey}`、`Content-Type: application/json`；body 含 `model`、`temperature`、`response_format: { type: 'json_object' }` 或在 prompt 中强约束 JSON（兼容不支持 json_object 的服务：优先 prompt 约束，正则提取 JSON 数组）。
  - 每片完成后 `progress` 上报。
- `AIService`（仿 `ASRService`）：
  - 内持 `engine = new OpenAICompatibleEngine()`。
  - `setProgressCallback(cb)` 转发。
  - `correct(items, model)` / `translate(items, model, targetLang)` 转发。
  - 导出全局单例 `aiService`。

### 5) Hook 编排 — 新增 `src/hooks/useAI.ts`
- 仿 `useASR.ts` 模式，编排纠错/翻译：
  - 读取 `appStore.aiModels / selectedAIModelId`、`historyStore.chunks`（过滤 `!deleted`）。
  - `runCorrection()` / `runTranslation(targetLang)`：
    1. 校验选中 AI 模型存在；无则 toast 警告并返回。
    2. 设 `appStore.setAIProgress({ status:'running', progress:0 })`。
    3. 调用 `aiService.correct/translate`，绑定进度回写 `appStore.setAIProgress`。
    4. 成功：调用 `historyStore.batchUpdateText(results)`（纠错写 `text`，翻译写 `secondText`）。
    5. toast 成功/失败（复用 `messageStore` hooks）。
    6. `setAIProgress({ status:'complete'|'error' })`；超时清空（参考 `setError` 自动清除模式）。

### 6) AI 模型管理 UI — 新增 `src/components/AISettingsPanel/AISettingsPanel.tsx`（+ `index.ts`）
- 复用 Shadcn `Dialog`、`Input`、`Label`、`Select`、`Button`、`Switch`。
- 顶部"模型列表"：循环 `appStore.aiModels`，每行展示 `name`、`model`、`baseUrl`，右侧「编辑」「删除」按钮；高亮 `selectedAIModelId`，点击行设为选中。
- 底部「添加模型」按钮打开表单 Dialog（字段：name、baseUrl、apiKey、model、temperature），保存调用 `addAIModel`/`updateAIModel`。
- 挂载位置：`src/FlyCutCaption.tsx` 的 `api` Tab 内容体，替换现有占位文字；保留其标题（外部 API）作为父级语义。
- 增加 API Key 明文本地存储的隐私提示文案（小字 `text-aimu-text-muted`）。

### 7) 纠错 / 翻译触发 UI — 改造 `src/components/SubtitleEditor/SubtitleList.tsx`
- 头部右侧当前 disabled 的「翻译语言下拉 + 开始按钮」区改造为：
  - 语言 `Select`：选项来自 `src/constants/languages.ts` 已有语言列表（如可复用），绑定本地 `useState` 存 `targetLang`。
  - 模型 `Select`：选项来自 `appStore.aiModels`，绑定 `appStore.selectedAIModelId`。无模型时显示「请先在设置中添加」并禁用按钮。
  - 「纠错」按钮：调用 `useAI().runCorrection()`，loading 态显示 `Loader2`。
  - 「翻译」按钮（原 Start）：调用 `useAI().runTranslation(targetLang)`，loading 态显示 `Loader2`。
  - 运行中 (`aiProgress.status==='running'`) 时禁用两个按钮并显示进度文案（复用 `appStore.aiProgress.data`）。
- 进度/错误信息可直接复用底部状态栏或最小化展示文案。

### 8) i18n 文案 — 修改 `src/locales/zh_CN.ts`、`en_US.ts`、`src/locales/types.ts`
- 在 `components` 下新增 `aiSettings` 段：`title`、`addModel`、`editModel`、`name`、`baseUrl`、`apiKey`、`model`、`temperature`、`selectModel`、`noModel`、`delete`、`save`、`cancel`、`apiKeyHint`（本地存储提示）。
- 在 `components.workstation` 段新增/补全：`correctSubtitle`、`translateSubtitle`(已存在)、`translateStart`、`correcting`、`translating`、`aiError`、`aiSuccess`。
- 对应 `types.ts` 新增这些字段类型，保证 zh/en 同步；缺失会导致 TS 报错。

### 9) Tab 装配 — 修改 `src/FlyCutCaption.tsx`
- `api` Tab 渲染体改为 `<AISettingsPanel />`（替换当前占位文本）。
- 其余 Tab 不动。

## Verification Steps
1. `pnpm tsc -b --noEmit`：通过类型检查（重点验证 i18n types、新增 store/ai 类型）。
2. `pnpm lint`：通过 ESLint。
3. `pnpm dev` 启动后人工验证：
   - 设置中「添加模型」保存后刷新页面依旧存在（persist 生效）。
   - 未选模型时「纠错/翻译」按钮禁用且提示。
   - 选择一个真实 OpenAI 兼容模型后，对一段字幕执行「字幕翻译」：检查 `secondText` 被写入、字幕显示切到 `Bilingual` 可见译文、底部 undo 后译文消失、redo 后恢复。
   - 执行「字幕纠错」：检查 `text` 被更新、对应行可见文案变化、undo 生效。
   - 故意填错 apiKey：按钮变回可点、错误 toast 出现、`aiProgress.status==='error'` 后清空。
4. 验证不影响 ASR 既有流程（导入视频→ASR→字幕编辑→导出）正常。