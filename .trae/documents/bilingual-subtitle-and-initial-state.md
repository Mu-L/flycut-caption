# 双语字幕样式分离 + 初始空状态 + 导出选项扩展

## Summary

为 FlyCut Caption 实现三项功能增强：
1. **初始空状态**：无视频时字幕/时间轴显示空状态，播放器区显示「上传文件 / 使用示例视频」入口；点击示例视频加载 demo.mp4 + 演示双语字幕。
2. **双语字幕样式分离**：主/副字幕拥有独立样式（颜色/字号/描边/背景/字体），位置（底边距/画面比例）共享 primary；播放器按 displayMode 渲染；SubtitleSettings 增加主/副 Tab 分别编辑样式 + 顶部 display 模式选择器。
3. **导出选项扩展**：字幕导出与视频烧录均支持 exportMode（主/副/双语），ASS 导出支持双样式，WebAV 烧录降级为 primary + 合并文本。

## Current State Analysis

### 已完成（Task 1-2）
- `src/subtitle/subtitleStyle.ts`：已新增 `defaultSecondarySubtitleStyle`、`SubtitleStylePair`、`defaultSubtitleStylePair`。
- `src/subtitle/subtitleRenderer.ts`：`renderSubtitleFrame` 已改造为接收 `primaryStyle` + `secondaryStyle?` + `displayMode?`，`TextBlock` 携带自身 `style`，按 displayMode 决定渲染主/副/双语。
- re-export 链路（`subtitle/index.ts`、`SubtitleSettings/index.ts`、`types.ts`、`src/index.ts`）已打通。

### 待改造现状
- **SubtitleOverlay.tsx**：Props 仍为单一 `style` + `onStyleChange`；`currentSubtitle` 匹配只看 `chunk.text`；`renderSubtitleFrame` 调用传单一 `style`。
- **EnhancedVideoPlayer.tsx**：Props 仍为 `subtitleStyle?` + `onSubtitleStyleChange?`。
- **SubtitleSettings.tsx**：Props 为 `style` + `onStyleChange`，无 Tab 结构。
- **exportFormats.ts**：`chunkBody` 总输出双语；`chunksToAss` 单一 Default 样式；无 exportMode。
- **ExportDialog.tsx**：`onExportSubtitles(format)` 无 exportMode 参数；视频导出无样式对。
- **burnAss.ts**：`buildBurnAssContent` 接收单一 `style`，用 `formatBilingualText` 合并双语。
- **videoEngine.ts**：`VideoProcessingOptions.subtitleStyle?: SubtitleStyle`（单一）。
- **FFmpegTauriEngine.ts**：使用 `options.subtitleStyle`（单一）。
- **WebAVEngine.ts**：`addBurnedSubtitles(subtitleChunks, keptSegments, subtitleStyle?)` 单一样式；`EmbedSubtitlesClip` API 只支持单一样式。
- **FlyCutCaption.tsx**：
  - L852-858：无视频时自动填充 mockTranscript（需删除以实现空状态）。
  - L949：`useState<SubtitleStyle>(defaultSubtitleStyle)`（需改为 stylePair）。
  - L961-964：`timelineDuration` 依赖 `mockTranscript.duration` 兜底（需移除）。
  - L1050-1070：`handleExportSubtitles` 无 exportMode。
  - L1230-1241：`handleVideoExport` 传单一 `subtitleStyle`。
  - L1418：无视频时渲染 `MockVideoPreview`（需改为上传/示例入口）。
- **appStore.ts**：`display: 'Bilingual' | 'Main' | 'Second'` 字段 + `setDisplay` 已存在并持久化，但未下传到播放器。
- **i18n**：`displayBilingual/displayMain/displaySecond` key 已存在；缺 Tab 与导出模式相关 key。
- **demo.mp4**：`src/assets/demo.mp4` 已存在。

## Assumptions & Decisions

1. **副字幕样式独立性**（已确认）：颜色/字号/描边/背景/字体独立；`bottomOffsetRatio` 与 `aspectPreset` 共享 primary（渲染器已用 primaryStyle 解析底边距）。
2. **Tab 显示策略**（已确认）：始终显示主/副两个 Tab，不随 displayMode 隐藏。
3. **displayMode vs exportMode**：两者独立。displayMode 控制播放器预览（存 appStore）；exportMode 控制导出内容（ExportDialog 本地状态，默认跟随 displayMode）。
4. **WebAV 烧录降级**：`EmbedSubtitlesClip` 只支持单一样式 → Bilingual 模式用 primaryStyle + `formatBilingualText` 合并；Main 用 primaryStyle；Second 用 secondaryStyle。在 ExportDialog 提示 WebAV 限制。
5. **ASS 双样式**：Bilingual 模式定义 Primary + Secondary 两个 Style，每个 chunk 输出两条 Dialogue（不同 Layer/Style），实现真正双样式。
6. **exportMode 类型**：复用 `SubtitleDisplayMode = 'Bilingual' | 'Main' | 'Second'`（已在 subtitleRenderer 导出）。
7. **示例视频加载**：加载 demo.mp4（通过 `new URL('../assets/demo.mp4', import.meta.url).href`）+ mockTranscript，直接 `setStage('edit')` 跳过 ASR，并设 `asrStartedRef.current = true` 双保险。
8. **display 选择器位置**：放在 SubtitleSettings 面板顶部（Tab 之上），作为 3 段式选择器，写入 appStore.display。
9. **FlyCutCaption 是 SubtitleSettings/EnhancedVideoPlayer 唯一消费者**（基于代码结构假设，实现时验证）。

## Proposed Changes

### 模块一：初始空状态 + 示例视频入口

#### 文件：`src/FlyCutCaption.tsx`
- **删除 L852-858** 的 mockTranscript 自动填充 useEffect。
- **修改 L961-964** `timelineDuration`：移除 `mockTranscript.duration` 兜底，改为 `Math.max(videoFile?.duration || 0, chunkEndTime)`。
- **新增 `handleLoadSampleVideo`**：用 `import demoVideoUrl from '@/assets/demo.mp4'` 拿到 URL，构造 VideoFile（duration 在 loadedmetadata 后由播放器回填，初始 0），调用 `handleFileSelect` 装载视频文件，然后 `setTranscript(mockTranscript)` + `useAppStore.getState().setStage('edit')` + `asrStartedRef.current = true`。
  - 注意：`handleFileSelect` 会 reset history + clearASRProgress + setVideoFile（切到 transcribe）。需在 setVideoFile 之后覆盖 stage 为 'edit' 并填充 transcript，且设 asrStartedRef 阻止 ASR 自动触发。
- **替换 L1417-1419** `MockVideoPreview` 分支：新增 `EmptyVideoState` 组件（内联或独立），包含「上传文件」按钮（复用 `handleUploadClick`）与「使用示例视频」按钮（调用 `handleLoadSampleVideo`）。保留 MockVideoPreview 的视觉风格（可选删除 MockVideoPreview 组件，或保留备用）。
- **demo.mp4 导入**：在文件顶部 `import demoVideoUrl from '@/assets/demo.mp4';`（Vite 原生支持，返回 URL 字符串）。

#### 文件：`src/locales/zh_CN.ts` / `en_US.ts`
- 新增 key：`workstation.emptyUploadHint`（"上传视频或音频文件开始" / "Upload a video or audio file to start"）、`workstation.useSampleVideo`（"使用示例视频" / "Use sample video"）、`workstation.emptyTimelineHint`（"暂无字幕，上传文件或识别后生成" / "No subtitles yet"）。

### 模块二：双语字幕样式分离 + 播放器联动

#### 文件：`src/components/VideoPlayer/SubtitleOverlay.tsx`
- **Props 改造**：
  ```ts
  interface SubtitleOverlayProps {
    currentTime: number;
    primaryStyle: SubtitleStyle;
    secondaryStyle?: SubtitleStyle;
    displayMode?: SubtitleDisplayMode;
    onPrimaryStyleChange: (style: SubtitleStyle) => void;
    containerDimensions: { width: number; height: number };
    videoDimensions: { width: number; height: number };
    visible?: boolean;
    className?: string;
  }
  ```
- **currentSubtitle 匹配**：按 displayMode 切换匹配字段。'Second' 模式匹配 `chunk.secondText`；其余匹配 `chunk.text`。仍用 `!chunk.deleted && 时间区间` 过滤。
- **renderSubtitleFrame 调用**：传 `primaryStyle`、`secondaryStyle`、`displayMode`、`content: { primaryText, secondText }`。
- **拖拽逻辑**：`handleDragStart/Move` 改用 `primaryStyle.bottomOffsetRatio`，回调改为 `onPrimaryStyleChange({ ...primaryStyle, bottomOffsetRatio: newRatio })`。
- **visible 判断**：`primaryStyle.visible`（副字幕可见性跟随主，简化）。
- **bottomOffsetDisplay**：用 `resolveBottomOffset(primaryStyle, videoHeight)`。
- 从 `@/subtitle` import `SubtitleDisplayMode` 类型；不再需要单一 `style` prop。

#### 文件：`src/components/VideoPlayer/EnhancedVideoPlayer.tsx`
- **Props 改造**：
  ```ts
  interface EnhancedVideoPlayerProps {
    className?: string;
    videoUrl?: string;
    onTimeUpdate?: (time: number) => void;
    onPlay?: () => void;
    onPause?: () => void;
    primaryStyle?: SubtitleStyle;
    secondaryStyle?: SubtitleStyle;
    displayMode?: SubtitleDisplayMode;
    onPrimaryStyleChange?: (style: SubtitleStyle) => void;
    onVideoDimensionsChange?: (dimensions: { width: number; height: number }) => void;
  }
  ```
- **L481-497 SubtitleOverlay 调用**：传 `primaryStyle`、`secondaryStyle`、`displayMode`、`onPrimaryStyleChange`。渲染条件改为 `primaryStyle && actualVideoDisplaySize.width > 0`。
- **import**：从 `@/subtitle` 引入 `SubtitleDisplayMode`；移除旧 `SubtitleStyle` 单一 import（仍需 SubtitleStyle 类型）。

#### 文件：`src/components/SubtitleSettings/SubtitleSettings.tsx`
- **Props 改造**：
  ```ts
  interface SubtitleSettingsProps {
    stylePair: SubtitleStylePair;
    onStylePairChange: (pair: SubtitleStylePair) => void;
    displayMode?: SubtitleDisplayMode;
    onDisplayModeChange?: (mode: SubtitleDisplayMode) => void;
    className?: string;
  }
  ```
- **新增 Tab 状态**：`const [activeStyleTab, setActiveStyleTab] = useState<'primary' | 'secondary'>('primary');`
- **display 模式选择器**（面板顶部，Tab 之上）：3 段式按钮组（双字幕/主字幕/副字幕），读写 `displayMode`/`onDisplayModeChange`。仅在存在副字幕内容时显示？不——始终显示（用户可能先调样式再加字幕）。简化：始终显示。
- **Tab 栏**：两个 Tab「主字幕」「副字幕」，切换 `activeStyleTab`。
- **当前编辑样式**：`const activeStyle = activeStyleTab === 'primary' ? stylePair.primary : stylePair.secondary;`
- **updateStyle**：按 activeStyleTab 回写对应分支：
  ```ts
  const updateActiveStyle = (updates: Partial<SubtitleStyle>) => {
    onStylePairChange({
      ...stylePair,
      [activeStyleTab]: { ...activeStyle, ...updates },
    });
  };
  ```
- **预设/字体/字号/颜色/描边/背景/字间距/行距**：全部作用于 `activeStyle` + `updateActiveStyle`。
- **位置与大小（bottomOffset）**：始终编辑 primary（因为位置共享）。当 activeStyleTab === 'secondary' 时，bottomOffset 滑块禁用并显示提示「底边距由主字幕控制」，或直接隐藏该行。简化：secondary Tab 下 bottomOffset 行禁用 + 灰显，tooltip 说明。
- **aspectPreset**：由 FlyCutCaption 层对 primary 调用 `applyAspectPreset`（已有逻辑），secondary 不单独设。
- **import**：引入 `SubtitleStylePair`、`SubtitleDisplayMode`。

#### 文件：`src/FlyCutCaption.tsx`（样式状态改造）
- **L949**：`const [subtitleStylePair, setSubtitleStylePair] = useState<SubtitleStylePair>(() => defaultSubtitleStylePair);`
- **新增 display 读写**：`const display = useAppStore(state => state.display); const setDisplay = useAppStore(state => state.setDisplay);`
- **L1401-1415 EnhancedVideoPlayer 调用**：传 `primaryStyle={subtitleStylePair.primary}`、`secondaryStyle={subtitleStylePair.secondary}`、`displayMode={display}`、`onPrimaryStyleChange={(s) => setSubtitleStylePair(prev => ({ ...prev, primary: s }))}`。
- **L1410-1413 onVideoDimensionsChange**：`applyAspectPreset` 只作用于 primary：`setSubtitleStylePair(prev => ({ ...prev, primary: prev.primary.aspectPreset === preset ? prev.primary : applyAspectPreset(prev.primary, preset) }))`。
- **L1446-1449 SubtitleSettings 调用**：传 `stylePair={subtitleStylePair}`、`onStylePairChange={setSubtitleStylePair}`、`displayMode={display}`、`onDisplayModeChange={setDisplay}`。
- **import**：新增 `defaultSubtitleStylePair`、`SubtitleStylePair`、`SubtitleDisplayMode`；移除 `defaultSubtitleStyle`（不再直接用，但 applyAspectPreset/inferAspectPreset 仍需）。

#### 文件：`src/components/SubtitleSettings/index.ts`
- 已 re-export `SubtitleStylePair`、`defaultSubtitleStylePair`、`defaultSecondarySubtitleStyle`（Task 1 完成）。补充 re-export `SubtitleDisplayMode`（从 `@/subtitle`）。

#### 文件：`src/subtitle/index.ts`
- 确认 re-export `SubtitleDisplayMode`（subtitleRenderer 已导出该类型，需在 index 补 re-export）。

### 模块三：导出选项扩展

#### 文件：`src/subtitle/exportFormats.ts`
- **新增 exportMode 参数**：`chunkBody(chunk, exportMode)` 按 mode 过滤：
  - 'Main'：返回 `chunk.text`
  - 'Second'：返回 `chunk.secondText?.trim() ? chunk.secondText : ''`（无副字幕则空，跳过）
  - 'Bilingual'：`chunk.secondText?.trim() ? `${chunk.text}\n${chunk.secondText}` : chunk.text`（当前行为）
- **chunksToSrt/Vtt/Json**：接收 `exportMode` 参数；过滤掉 body 为空的 chunk。
- **chunksToAss**：接收 `stylePair: SubtitleStylePair` + `exportMode`：
  - 'Main'：单 Default 样式 = primaryStyle，Dialogue text = chunk.text
  - 'Second'：单 Default 样式 = secondaryStyle（但 marginV 用 primary 的 bottomOffsetRatio，保证位置一致），Dialogue text = chunk.secondText
  - 'Bilingual'：双样式（Primary + Secondary）。Primary 的 marginV = `playResY * primaryStyle.bottomOffsetRatio`；Secondary 的 marginV = primary marginV + primaryFontSize * lineHeight + gap。每个 chunk 输出两条 Dialogue（Primary layer=1，Secondary layer=0），text 分别为 chunk.text 与 chunk.secondText，用 `\N` 换行。仅在 secondText 非空时输出第二条。
- **AssExportOptions**：改为 `{ playResX, playResY, stylePair, exportMode, title? }`。
- **serializeSubtitleExport**：签名加 `exportMode?: SubtitleDisplayMode`（默认 'Bilingual'），透传给 chunksTo*。
- 兼容：`defaultSubtitleStyle` 兜底改为 `defaultSubtitleStylePair`。

#### 文件：`src/subtitle/burnAss.ts`
- **BuildBurnAssOptions**：`style: SubtitleStyle` → `stylePair: SubtitleStylePair` + `exportMode: SubtitleDisplayMode`。
- **buildBurnAssContent**：
  - 'Main'：dialogueChunks 用 chunk.text（不合并）
  - 'Second'：dialogueChunks 用 chunk.secondText（移到 text，secondText=undefined）
  - 'Bilingual'：保留现有 `formatBilingualText` 合并逻辑（用 primaryStyle），secondText=undefined
  - 调用 `chunksToAss(dialogueChunks, { playResX, playResY, stylePair, exportMode })`
  - 注意：Bilingual 模式下 burnAss 仍用合并文本（单样式），与 exportFormats 的 ASS 双样式不同——因为 FFmpeg 烧录单样式更稳定。或者统一用 exportFormats 的双样式？为一致性，Bilingual 模式 burnAss 也用双样式（不在 burnAss 合并，交给 chunksToAss 处理）。即：burnAss 不再调 formatBilingualText，直接传原始 chunks + stylePair + exportMode 给 chunksToAss。

#### 文件：`src/types/videoEngine.ts`
- **VideoProcessingOptions** 新增：
  ```ts
  subtitleStylePair?: SubtitleStylePair;
  subtitleExportMode?: SubtitleDisplayMode;
  ```
- 保留 `subtitleStyle?: SubtitleStyle`（向后兼容，引擎优先用 stylePair）。
- import `SubtitleStylePair` from `@/subtitle`；`SubtitleDisplayMode` from `@/subtitle`。

#### 文件：`src/services/videoEngines/FFmpegTauriEngine.ts`
- **L117-136 processVideo**：`options.subtitleStyle` → 优先 `options.subtitleStylePair`：
  ```ts
  const stylePair = options.subtitleStylePair ?? { primary: options.subtitleStyle!, secondary: options.subtitleStyle! };
  const exportMode = options.subtitleExportMode ?? 'Bilingual';
  assContent = buildBurnAssContent({ chunks, keptSegments: segments, stylePair, exportMode, playResX, playResY });
  ```

#### 文件：`src/services/videoEngines/WebAVEngine.ts`
- **L217 addBurnedSubtitles 调用**：传 `stylePair` + `exportMode`。
- **addBurnedSubtitles 签名**：`(subtitleChunks, keptSegments, stylePair?, exportMode?)`。
- **逻辑**：
  - 'Main'：effectiveStyle = stylePair.primary；text = chunk.text
  - 'Second'：effectiveStyle = stylePair.secondary；text = chunk.secondText（跳过无 secondText 的 chunk）
  - 'Bilingual'：effectiveStyle = stylePair.primary；text = formatBilingualText(chunk.text, chunk.secondText, primaryStyle, w, h)（降级，单样式）
- **generateSubtitleStructs**：按 exportMode 过滤/合并文本。

#### 文件：`src/components/ExportPanel/ExportDialog.tsx`
- **Props 扩展**：
  ```ts
  onExportSubtitles: (format, exportMode: SubtitleDisplayMode) => void;
  onExportVideo: (options: VideoExportOptions) => void; // VideoExportOptions 加 subtitleExportMode
  ```
- **VideoExportOptions** 新增 `subtitleExportMode: SubtitleDisplayMode`。
- **字幕导出区**：在格式选择之上新增「导出内容」选择器（3 段式：双字幕/主字幕/副字幕），默认值由外部传入（跟随 displayMode）。
- **视频导出区**：当 subtitleProcessing !== 'none' 时，显示「字幕内容」选择器（同上）。
- **WebAV 限制提示**：当非 Tauri 且 hard 烧录且 exportMode='Bilingual' 时，提示「Web 端烧录副字幕样式与主字幕一致」。

#### 文件：`src/FlyCutCaption.tsx`（导出改造）
- **handleExportSubtitles**：签名加 `exportMode`；`serializeSubtitleExport(format, keptChunks, { ass: { playResX, playResY, stylePair: subtitleStylePair, exportMode }, exportMode })`。
- **handleVideoExport**：`options.subtitleExportMode` 透传；`subtitleStylePair: subtitleStylePair`；`subtitleStyle: subtitleStylePair.primary`（兼容）。
- **ExportDialog 调用**：`onExportSubtitles={(format, mode) => handleExportSubtitles(format, mode)}`；传 `defaultExportMode={display}`。

### 模块四：i18n + 验证

#### 文件：`src/locales/zh_CN.ts` / `en_US.ts`
新增 key（workstation 下）：
- `primarySubtitleTab`：主字幕 / Primary
- `secondarySubtitleTab`：副字幕 / Secondary
- `exportContent`：导出内容 / Export content
- `exportBilingual`：双字幕 / Bilingual
- `exportMain`：仅主字幕 / Primary only
- `exportSecond`：仅副字幕 / Secondary only
- `bottomOffsetLocked`：底边距由主字幕控制 / Bottom offset controlled by primary
- `webavBilingualHint`：Web 端烧录副字幕样式与主字幕一致 / Web burn uses primary style for secondary
- `emptyUploadHint`、`useSampleVideo`、`emptyTimelineHint`（模块一已列）

#### 验证步骤
1. `pnpm tsc -b --noEmit` — 类型检查通过。
2. `pnpm lint` — ESLint 通过。
3. 手动验证：
   - 初始进入：播放器区显示「上传/示例」按钮，字幕编辑器与时间轴空状态。
   - 点「使用示例视频」：加载 demo.mp4 + 双语字幕，播放器显示双字幕，时间轴有内容。
   - SubtitleSettings 顶部 display 选择器切换：播放器实时切换主/副/双语。
   - SubtitleSettings 主/副 Tab 切换：分别编辑样式，播放器实时反映。
   - 副 Tab 下 bottomOffset 禁用。
   - 导出字幕选「仅主字幕」：SRT 只含主文本。
   - 导出视频选「仅副字幕」+ 硬烧录：FFmpeg 路径用 secondaryStyle。

## 实现顺序

1. **模块二基础**（SubtitleOverlay + EnhancedVideoPlayer + SubtitleSettings + FlyCutCaption 样式状态）— 先打通预览链路。
2. **模块一**（空状态 + 示例视频）— 依赖 stylePair 状态已就绪。
3. **模块三**（exportFormats + burnAss + 引擎 + ExportDialog + FlyCutCaption 导出）。
4. **模块四**（i18n + 验证）。

每模块完成后跑 `pnpm tsc -b --noEmit` 局部验证，全部完成后跑 `pnpm lint`。
