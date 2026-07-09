# 双语字幕 + 初始空状态 — 收尾实现计划

本计划承接上一会话，聚焦尚未完成的三块工作：`burnAss.ts` 改造、导出链路（引擎/类型/ExportDialog/FlyCutCaption）打通、i18n 补全与编译验证。模块一（初始空状态 + 示例视频）与模块二（双语样式分离 + 播放器联动）已实现并验证通过；模块三的 `exportFormats.ts` 已重写完成（支持 `stylePair` + `exportMode`，ASS Bilingual 输出双样式）。

## 当前状态分析（已验证）

已完成（无需改动）：
- `src/subtitle/subtitleStyle.ts`：`SubtitleStylePair` / `defaultSubtitleStylePair` / `defaultSecondarySubtitleStyle` 已就绪。
- `src/subtitle/subtitleRenderer.ts`：`renderSubtitleFrame` 已接受 `primaryStyle` + `secondaryStyle?` + `displayMode?`。
- `src/subtitle/exportFormats.ts`：`AssExportOptions = { playResX, playResY, stylePair, exportMode?, title? }`；`chunksToSrt/Vtt/Json/Ass` 均接 `exportMode`；`serializeSubtitleExport(format, chunks, options?)` 支持 `exportMode`；ASS Bilingual 输出 Primary(layer 0) + Secondary(layer 1) 双样式。
- `src/subtitle/index.ts`：已 re-export `SubtitleStylePair` / `SubtitleDisplayMode` / `buildBurnAssContent`。
- `src/components/SubtitleSettings/index.ts`：已 re-export `SubtitleStyle` / `SubtitleStylePair` / `SubtitleDisplayMode`。
- `src/components/VideoPlayer/SubtitleOverlay.tsx` + `EnhancedVideoPlayer.tsx`：已接 `primaryStyle`/`secondaryStyle`/`displayMode`/`onPrimaryStyleChange`。
- `src/components/SubtitleSettings/SubtitleSettings.tsx`：已有主/副 Tab + display 选择器；引用 i18n key：`primarySubtitleTab`/`secondarySubtitleTab`/`bottomOffsetLocked`/`display*`（**这些 key 尚未在 locale 文件中定义**）。
- `src/FlyCutCaption.tsx`：空状态 UI（上传按钮 + 示例视频按钮）已实现，引用 `useSampleVideo`（**尚未定义**）；`handleLoadSampleVideo` 已实现；`subtitleStylePair` 状态 + `display`/`setDisplay`（appStore）已接入播放器与 SubtitleSettings。
- `src/stores/appStore.ts`：`display: 'Bilingual'|'Main'|'Second'`（L51，默认 `'Bilingual'`）+ `setDisplay`（L92）已存在并持久化（L405）。

待完成（本计划范围）：
1. `burnAss.ts`：单一 `style` → `stylePair` + `exportMode`，移除 `formatBilingualText` 合并。
2. `videoEngine.ts` + `FFmpegTauriEngine.ts` + `WebAVEngine.ts`：接入 `subtitleStylePair` + `subtitleExportMode`。
3. `ExportDialog.tsx`：新增「导出内容」选择器（主/副/双语），`onExportSubtitles(format, exportMode)`，`VideoExportOptions.subtitleExportMode`。
4. `FlyCutCaption.tsx`：`handleExportSubtitles` / `handleVideoExport` 接 `exportMode`，透传 `stylePair`。
5. i18n：补全 `types.ts` / `zh_CN.ts` / `en_US.ts` 中已引用但缺失的 key + 新增导出相关 key。
6. 编译验证。

## 提议改动

### Task A — `src/subtitle/burnAss.ts`

**目标**：与 `exportFormats.chunksToAss` 对齐，烧录 ASS 也走 `stylePair` + `exportMode`，Bilingual 模式输出双样式（不在 burnAss 合并文本，交给 `chunksToAss` 处理）。

改动：
- import：移除 `SubtitleStyle`、`formatBilingualText`；新增 `SubtitleStylePair`、`SubtitleDisplayMode`（从 `./subtitleStyle` / `./subtitleRenderer`）。
- `BuildBurnAssOptions`：
  ```ts
  export interface BuildBurnAssOptions {
    chunks: SubtitleChunk[];
    keptSegments: VideoSegment[];
    stylePair: SubtitleStylePair;
    exportMode: SubtitleDisplayMode;
    playResX: number;
    playResY: number;
  }
  ```
- `buildBurnAssContent`：
  - `activeChunks = chunks.filter(c => !c.deleted && c.text.trim())`（保持主文本非空过滤；`chunksToAss` 内部再按 exportMode 决定输出 secondText）。
  - 时间重映射逻辑不变（`mapSubtitleTimingsToCutVideo` + `applyMappedTimings`）。
  - **删除** `dialogueChunks.map` 中的 `formatBilingualText` 合并，直接传 `remapped` 给 `chunksToAss`。
  - 调用：`chunksToAss(remapped, { playResX, playResY, stylePair, exportMode, title: 'FlyCut Caption Burn' })`。

### Task B — `src/types/videoEngine.ts`

改动：
- import：从 `@/subtitle` 引入 `SubtitleStylePair`、`SubtitleDisplayMode`（替换现有 `@/components/SubtitleSettings` 的 `SubtitleStyle` import，统一来源；`SubtitleStyle` 仍需保留用于 `subtitleStyle` 兼容字段，从 `@/subtitle` 一并引入）。
- `VideoProcessingOptions` 新增两个字段（保留 `subtitleStyle?` 向后兼容）：
  ```ts
  subtitleStylePair?: SubtitleStylePair;
  subtitleExportMode?: SubtitleDisplayMode;
  ```

### Task C — `src/services/videoEngines/FFmpegTauriEngine.ts`

改动（L117-136 `processVideo`）：
- 条件改为：`subtitleProcessing !== 'none' && (options.subtitleStylePair || options.subtitleStyle)`。
- 解析 stylePair 与 exportMode：
  ```ts
  const stylePair = options.subtitleStylePair
    ?? { primary: options.subtitleStyle!, secondary: options.subtitleStyle! };
  const exportMode = options.subtitleExportMode ?? 'Bilingual';
  ```
- `buildBurnAssContent({ chunks, keptSegments: segments, stylePair, exportMode, playResX, playResY })`。
- FFmpeg + libass 支持双 layer/双样式，Bilingual 模式直接用 `chunksToAss` 的双样式输出，无需降级。

### Task D — `src/services/videoEngines/WebAVEngine.ts`

**约束**：`EmbedSubtitlesClip` API 只支持单一样式，Bilingual 模式必须降级为 `primaryStyle` + `formatBilingualText` 合并文本。

改动：
- import：新增 `SubtitleStylePair`、`SubtitleDisplayMode`（从 `@/subtitle`）；保留 `SubtitleStyle`、`defaultSubtitleStyle`、`formatBilingualText`。
- L217 调用：`await this.addBurnedSubtitles(subtitleChunks, keptSegments, options.subtitleStylePair, options.subtitleExportMode, options.subtitleStyle);`
- `addBurnedSubtitles` 签名：
  ```ts
  private async addBurnedSubtitles(
    subtitleChunks: TranscriptChunk[],
    keptSegments: VideoSegment[],
    stylePair?: SubtitleStylePair,
    exportMode?: SubtitleDisplayMode,
    fallbackStyle?: SubtitleStyle,
  ): Promise<void>
  ```
- 逻辑：
  - 解析：`const pair = stylePair ?? { primary: fallbackStyle ?? defaultSubtitleStyle, secondary: fallbackStyle ?? defaultSubtitleStyle };` `const mode = exportMode ?? 'Bilingual';`
  - 选 effectiveStyle：`mode === 'Second' ? pair.secondary : pair.primary`。
  - `generateSubtitleStructs` 增加 `stylePair` + `exportMode` 参数：
    - 'Main'：text = `chunk.text`（跳过无 text）
    - 'Second'：text = `chunk.secondText`（跳过无 secondText）
    - 'Bilingual'：text = `formatBilingualText(chunk.text, chunk.secondText, pair.primary, videoWidth, videoHeight)`（降级单样式合并）
  - `EmbedSubtitlesClip` 的样式参数继续用 effectiveStyle（Bilingual/Main 用 primary，Second 用 secondary）。

### Task E — `src/components/ExportPanel/ExportDialog.tsx`

改动：
- import：从 `@/subtitle` 引入 `SubtitleDisplayMode`；引入 `useTranslation`（i18n）。
- `VideoExportOptions` 新增：`subtitleExportMode: SubtitleDisplayMode;`
- Props 扩展：
  ```ts
  onExportSubtitles: (format: 'srt'|'json'|'vtt'|'ass', exportMode: SubtitleDisplayMode) => void;
  defaultExportMode?: SubtitleDisplayMode; // 跟随播放器 display
  ```
- 新增本地状态 `subtitleExportMode`，初始值 `defaultExportMode ?? 'Bilingual'`；`videoOptions.subtitleExportMode` 初始值同上。
- 新增「导出内容」3 段式选择器组件（双字幕/主字幕/副字幕），复用 `displayBilingual`/`exportMain`/`exportSecond` 文案：
  - 字幕导出区：在格式列表之上始终显示。
  - 视频导出区：仅当 `subtitleProcessing !== 'none'` 时显示。
- `handleSubtitleExport(format)` 改为传 `subtitleExportMode`：`onExportSubtitles(format, subtitleExportMode)`。
- `handleVideoExport`：`onExportVideo({ ...videoOptions, subtitleExportMode })`。
- WebAV 限制提示：当 `!env.isTauri && videoOptions.subtitleProcessing === 'hard' && subtitleExportMode === 'Bilingual'` 时，显示 `webavBilingualHint` 提示条。
- 现有硬编码中文（"导出字幕"/"导出视频"/"输出格式" 等）暂不强制 i18n（保持与现状一致，避免扩大改动面）；仅新增的导出内容选择器使用 i18n key。

### Task F — `src/FlyCutCaption.tsx`（导出改造）

改动：
- `handleExportSubtitles`：签名加 `exportMode: SubtitleDisplayMode`；
  ```ts
  const content = serializeSubtitleExport(format, keptChunks, {
    ass: { playResX: videoMeta.width, playResY: videoMeta.height, stylePair: subtitleStylePair, exportMode },
    exportMode,
  });
  ```
  依赖数组加 `exportMode`（通过参数传入，无需新增依赖）。
- `handleVideoExport`：
  ```ts
  await handleStartProcessing({
    format: options.format === 'mp4' ? 'mp4' : 'webm',
    quality: options.quality,
    preserveAudio: true,
    subtitleProcessing: options.subtitleProcessing,
    subtitleStyle: subtitleStylePair.primary, // 兼容
    subtitleStylePair: subtitleStylePair,
    subtitleExportMode: options.subtitleExportMode,
    videoWidth: videoMeta.width,
    videoHeight: videoMeta.height,
    engine: isTauriRuntime() ? 'ffmpeg-tauri' : undefined,
  });
  ```
- ExportDialog 调用（L1559-1565）：
  ```tsx
  <ExportDialog
    open={exportDialogOpen}
    onOpenChange={setExportDialogOpen}
    exportType={exportDialogType}
    defaultExportMode={display}
    onExportSubtitles={(format, mode) => handleExportSubtitles(format, mode)}
    onExportVideo={handleVideoExport}
  />
  ```
- import：从 `@/subtitle` 引入 `SubtitleDisplayMode`（`handleExportSubtitles` 参数类型）。

### Task G — i18n（`src/locales/types.ts` / `zh_CN.ts` / `en_US.ts`）

在 `components.workstation` 下新增以下 key（仅添加实际被代码引用的 key，不添加未引用的 `emptyUploadHint`/`emptyTimelineHint`）：

| key | zh_CN | en_US | 引用位置 |
|-----|-------|-------|---------|
| `primarySubtitleTab` | 主字幕 | Primary | SubtitleSettings L348 |
| `secondarySubtitleTab` | 副字幕 | Secondary | SubtitleSettings L360 |
| `bottomOffsetLocked` | 底边距由主字幕控制 | Bottom offset controlled by primary | SubtitleSettings L517 |
| `useSampleVideo` | 使用示例视频 | Use sample video | FlyCutCaption L1466 |
| `exportContent` | 导出内容 | Export content | ExportDialog（新增） |
| `exportBilingual` | 双字幕 | Bilingual | ExportDialog（新增） |
| `exportMain` | 仅主字幕 | Primary only | ExportDialog（新增） |
| `exportSecond` | 仅副字幕 | Secondary only | ExportDialog（新增） |
| `webavBilingualHint` | Web 端烧录时副字幕样式与主字幕一致 | Web burn uses primary style for secondary | ExportDialog（新增） |

注：`displayBilingual`/`displayMain`/`displaySecond` 已存在，导出选择器复用 `exportBilingual`/`exportMain`/`exportSecond` 以区分「导出」语义（避免与播放器 display 混淆）。

## 假设与决策

1. **burnAss Bilingual = 双样式**：与 `exportFormats.chunksToAss` 一致，不在 burnAss 合并文本。FFmpeg/libass 支持双 layer，无需降级。
2. **WebAV Bilingual = 降级单样式**：`EmbedSubtitlesClip` API 限制，用 `primaryStyle` + `formatBilingualText` 合并；UI 提示用户。
3. **exportMode 默认跟随 display**：ExportDialog 接 `defaultExportMode={display}`，但选择后独立于 display（仅影响本次导出）。
4. **保留 `subtitleStyle?` 向后兼容**：引擎优先用 `subtitleStylePair`，回退 `{ primary: subtitleStyle, secondary: subtitleStyle }`。
5. **不添加未引用的 i18n key**：`emptyUploadHint`/`emptyTimelineHint` 在代码中无引用，跳过。
6. **ExportDialog 现有硬编码中文暂不 i18n**：保持改动面聚焦，仅新增的导出内容选择器使用 i18n。

## 验证步骤

1. `pnpm tsc -b --noEmit` — 类型检查通过（重点：`buildBurnAssContent` / `VideoProcessingOptions` / `ExportDialog` props / `handleExportSubtitles` 签名）。
2. `pnpm lint` — ESLint 通过（重点：未使用 import 清理 — burnAss 的 `formatBilingualText`/`SubtitleStyle`）。
3. 手动验证（如条件允许）：
   - 初始进入：播放器区显示「上传/示例」按钮，字幕编辑器与时间轴空状态。
   - 点「使用示例视频」：加载 demo.mp4 + 双语字幕，播放器显示双字幕。
   - SubtitleSettings 主/副 Tab 切换 + display 选择器：播放器实时反映。
   - 导出字幕选「仅主字幕」：SRT 只含主文本；选「仅副字幕」：只含副文本。
   - 导出视频选「仅副字幕」+ 硬烧录（Tauri）：FFmpeg 用 secondaryStyle 烧录。
   - Web 端选「双字幕」+ 硬烧录：显示 `webavBilingualHint` 提示，烧录用合并文本。

## 实现顺序

1. Task A（burnAss.ts）— 独立，先改。
2. Task B（videoEngine.ts 类型）— 引擎依赖，第二。
3. Task C + D（FFmpegTauriEngine + WebAVEngine）— 依赖 A+B，可并行。
4. Task E（ExportDialog）— UI 层，依赖 B 的类型。
5. Task F（FlyCutCaption 导出）— 依赖 A-E。
6. Task G（i18n）— 可与 E/F 并行，但放最后统一补。
7. 编译验证（tsc + lint）。
