# 智能剪切空白段 功能实施计划

## 概述

为 FlyCut Caption 增加一键「智能剪切空白段」能力：基于已有字幕片段之间的时间戳间隙（`chunk[i].end ~ chunk[i+1].start`，以及首尾未覆盖区域）自动识别空白段；将超过阈值的空白段转换为「空白占位 chunk」（软删除），从而完整复用现有的预览跳过、导出裁剪、撤销重做链路。触发入口放在 `SubtitleList` 工具栏；阈值参数放到「模型下载」设置面板（`SettingsDialog`）。

## 当前状态分析

### 字幕数据模型
- `src/types/subtitle.ts`：`SubtitleChunk { text; secondText?; timestamp: [start, end]; id; selected?; deleted? }`，软删除标记 `deleted`。
- `src/stores/historyStore.ts`：Zustand store，`Chunk extends SubtitleChunk`。核心 actions：`delete`（单条软删除切换）、`deleteSelected`（批量软删除）、`restoreSelected`（批量恢复）、`undo/redo`。`HistoryAction` 支持 `UpdateAction`（单条 update）与 `BatchUpdateAction`（批量 update）。`computeDerivedState` 基于 `!deleted` 计算 `text`/`duration`。
- 关键发现：导出链路 `FlyCutCaption.tsx` 中 `videoSegments = chunks.map(c => ({ start, end, keep: !c.deleted }))`；`EnhancedVideoPlayer` 的 `previewMode` 用 `keptSegments = chunks.filter(!deleted)` 实现「播放时跳过非保留段」。

### 现有空白检测算法
- `src/utils/timeUtils.ts` 的 `calculatePausesAndSeparators(chunks, pauseThreshold, totalDuration)` 已能计算每两个 chunk 之间的间隙以及首尾停顿。
- `mergeTimeRanges`（第 77-97 行）可合并相邻时间范围。

### UI 现状
- `src/components/SubtitleEditor/SubtitleList.tsx`：底部工具栏含撤销/重做、全选/清空、删除选中、恢复已删除、统计；已 import `Wand2` 图标但未使用（第 8 行）——适合作为「智能剪切」按钮图标。
- `src/components/ProcessingPanel/SettingsDialog.tsx`：极简，仅 `ModelDownloadPanel`，可在此追加「智能剪切」参数区块。
- `src/locales/{types.ts,zh_CN.ts,en_US.ts}`：`components.workstation` 命名空间集中承载工作区动作文案（如 `translateStart`、`correctStart`）。

### 关键约束与决策依据
1. 空白段本身不是 chunk，而是 chunk 之间的间隙。要让预览/导出跳跃空白段，最自然的做法是在这些间隙位置插入「空白占位 chunk」并标记 `deleted: true`。
2. 导出 `videoProcessor` 本身会把 `keep:false` 段裁掉，但只要空白占位 chunk 的 `deleted=true`，`videoSegments` 即会输出 `keep:false`，语义与现有删除 chunk 完全一致 —— 无需改动 `UnifiedVideoProcessor` / `segmentUtils` / 导出对话框。
3. 预览侧 `EnhancedVideoPlayer.keptSegments` 取 `!deleted`，空白占位被排除，播放头会从上一段末跳到下一段首 —— 完整复用，无需改动播放器。

## 设计决策（决策完整版）

### D1：识别信号
基于**字幕时间戳间隙**。识别逻辑：
```
gapSegments = []
按 timestamp[0] 升序遍历 chunks（含 deleted=false 的活跃 chunk）：
  1) 首段前空隙：若 chunks[0].start >= threshold → [0, chunks[0].start]
  2) 段间空隙：gap = chunks[i].start - chunks[i-1].end；若 gap >= threshold → [chunks[i-1].end, chunks[i].start]
  3) 末段后空隙：若 totalDuration - chunks[last].end >= threshold → [chunks[last].end, totalDuration]
```
`totalDuration` 取自 `useAppStore` 的视频时长；若未知则只处理首/中段，不处理末段。

### D2：处理方式 —— 软删除空白占位 chunk
- 在 `historyStore` 新增 action `insertBlankChunks(segments: {start, end}[])`：把每个空白段作为一条 `Chunk` 插入（`text: ''`、`secondText: undefined`、`selected: false`、`deleted: true`、`isBlankSpacer: true`），并按 `timestamp[0]` 顺序插入到 chunks 数组合适位置（维护时间顺序）。
- 该操作作为**一次** `BatchUpdateAction`（复用 batch 语义）写入 `undoStack`，可整体撤销；撤销时移除这些占位 chunk（需扩展 `HistoryAction` 支持插入/移除，见 D4）。
- 衍生状态 `computeDerivedState` 天然忽略 `deleted:true`，文本/时长不变（空白段 text 为空）。

### D3：SubtitleChunk 类型扩展
在 `src/types/subtitle.ts` 的 `SubtitleChunk` 增加可选字段：
```ts
isBlankSpacer?: boolean; // 标识智能剪切插入的空白占位段
```
UI 侧（`SubtitleItem`、`SubtitleList` 统计）对 `isBlankSpacer` 项折叠/特殊渲染（显示「空白段」标签 + 时长，不渲染文本编辑框），并避免计入 `activeCount`/`deletedCount` 的常规字幕统计（或单独统计「空白段」数量）。

### D4：撤销机制 —— 新增 insert/remove 动作类型
为支持「插入占位 chunk 后可整体撤销移除」，扩展 `historyStore.ts` 的 `HistoryAction`：
```ts
interface InsertChunksAction {
  type: "insert";
  chunks: Chunk[]; // 插入的完整 chunk 对象（用于撤销时按 id 移除）
}
```
`undo` 时若动作是 `insert`，则从 `chunks` 中移除这些 id；`redo` 时重新插入。这样保持单一 undo 步骤，用户体验一致。
（若实现复杂度偏高，备选方案：每个空白占位 chunk 用普通 `UpdateAction`，但 `prev` 表示「不存在」——实现更脏。故采用 D4 主方案。）

### D5：阈值参数存储
在 `appStore`（`src/stores/appStore.ts`，已 `persist`）新增：
```ts
smartCutSilenceThreshold: number; // 秒，默认 1.5
setSmartCutSilenceThreshold: (v: number) => void;
```
设置面板 `SettingsDialog` 中新增「智能剪切」区块，用 `Slider`（0.2s ~ 5s，步长 0.1）+ 数值显示，参考 `SubtitleSettings.tsx` 的 `SliderRow` 模式。

### D6：入口与交互
`SubtitleList.tsx` 底部工具栏在「删除选中/恢复已删除」附近新增「智能剪切空白段」按钮（`Wand2` 图标，已 import）。点击：
1. 读取 `appStore.smartCutSilenceThreshold`；
2. 计算 gap segments；
3. 调用 `historyStore.insertBlankChunks(gapSegments)`；
4. 用 toast（`sonner`）反馈「已标记 N 个空白段，节省 X 秒」。
按钮禁用条件：`chunks.length === 0`；执行后可通过撤销恢复。可加二次确认（若已存在 `isBlankSpacer` chunk，提示「将先清理已有空白标记再重新识别」或直接跳过）。

## 计划修改的文件清单

| 文件 | 改动 | 说明 |
|---|---|---|
| `src/types/subtitle.ts` | 新增 `isBlankSpacer?: boolean` 到 `SubtitleChunk` | D3 类型标记 |
| `src/stores/appStore.ts` | 新增 `smartCutSilenceThreshold` 状态 + setter，纳入 `persist` 白名单 | D5 阈值持久化 |
| `src/stores/historyStore.ts` | 新增 `InsertChunksAction` 类型、`insertBlankChunks` action、`undo/redo` 对 insert 类型的处理 | D2/D4 核心逻辑 |
| `src/utils/timeUtils.ts` | 新增 `calculateBlankSegments(chunks, threshold, totalDuration)` 工具函数 | D1 识别算法 |
| `src/components/SubtitleEditor/SubtitleList.tsx` | 底部工具栏新增「智能剪切空白段」按钮 + handler + toast | D6 入口 |
| `src/components/SubtitleEditor/SubtitleItem.tsx` | 对 `isBlankSpacer` chunk 折叠渲染（显示「空白段 + 时长」、隐藏文本编辑框、删除即恢复） | D3 UI 适配 |
| `src/components/ProcessingPanel/SettingsDialog.tsx` | 新增「智能剪切」区块，含阈值 `Slider` | D5 参数 UI |
| `src/locales/types.ts` | `workstation` 接口新增键：`smartCutBlank`、`smartCutBlankDone`、`smartCutBlankEmpty` 等；新增 `settings.smartCut` 相关键 | i18n 类型 |
| `src/locales/zh_CN.ts` | 同步新增中文文案 | i18n |
| `src/locales/en_US.ts` | 同步新增英文文案（紧挨 `translateStart`，约第 301 行附近） | i18n |

## 实施步骤（按依赖顺序）

1. **类型与文案**：扩展 `SubtitleChunk` 字段；在 `types.ts`/`zh_CN.ts`/`en_US.ts` 新增 i18n 键（`components.workstation.smartCutBlank` = "智能剪切空白"/"Smart Cut Blank"；`settings.smartCutThreshold` = "空白阈值(秒)"/"Silence Threshold (s)"；`messages.subtitle.smartCutDone` = "已标记 {count} 个空白段，节省 {seconds}s" 等）。
2. **工具函数**：在 `timeUtils.ts` 实现 `calculateBlankSegments`，单元自验（输入测试数据）。
3. **appStore 阈值**：新增状态/setter/persist 白名单条目，默认 1.5s。
4. **historyStore action**：实现 `InsertChunksAction`、`insertBlankChunks`、`undo/redo` 对 insert 类型的处理；确保 `computeDerivedState` 不受影响；为新 chunk 生成稳定 id（如 `blank-${start}-${end}`）。
5. **SubtitleList 入口**：添加按钮 + handler；调用 `calculateBlankSegments` + `insertBlankChunks`；用 `sonner` toast 反馈；接入 `t()` 文案。
6. **SubtitleItem 适配**：`isBlankSpacer` 项渲染为单行「[空白段] 00:03.2 → 00:06.8 (3.6s)」，隐藏复选/编辑，删除按钮改为「移除标记」(restoreSelected)。
7. **SettingsDialog 阈值 UI**：在 `ModelDownloadPanel` 下方加分区标题 + `SliderRow`，绑定 `appStore.smartCutSilenceThreshold`。
8. **自测**：`pnpm tsc -b --noEmit` 通过；`pnpm lint` 通过；手动流程：上传视频→ASR→点击智能剪切→预览跳过空白→导出确认空白被裁→撤销恢复。

## 假设与前提

- 用户已确认：识别信号=字幕时间戳间隙；处理=软删除复用预览/导出；入口=`SubtitleList` 工具栏 + 设置面板放阈值参数。
- `useAppStore` 视频时长可用（参考现有 `EnhancedVideoPlayer` 用 `duration`  drowned 的方式）；如未持久化时长则末段空白识别跳过。
- `sonner` toast 已就绪（`src/components/ui/sonner.tsx` 存在）。
- 不触碰 FunASR/Tauri 侧；不改动 `UnifiedVideoProcessor`/`ExportDialog`/`segmentUtils`。

## 验证步骤

1. `pnpm tsc -b --noEmit` —— TypeScript 编译无错误。
2. `pnpm lint` —— ESLint 无新增错误。
3. 功能链路自测：
   - 加载含明显停顿的字幕；
   - 设置阈值为 2s，点击「智能剪切空白」；
   - 观察字幕列表出现「空白段」标记项、统计显示空白数量；
   - 播放器预览模式自动跳过空白；
   - 导出视频，确认输出时长缩减、空白段已裁掉；
   - 点击撤销，空白标记消失、列表恢复；
   - 点击重做，空白标记恢复。
4. 阈值改动后重新点击按钮：期望先清旧 `isBlankSpacer` 标记再按新阈值识别（或直接跳过已存在——实现时选择「跳过已识别」更安全，避免重复插入；如需重算，先撤销再执行）。