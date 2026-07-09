# Debug Session: subtitle-overlap

## 症状
预览时字幕会重叠，"所有时间的字幕都重叠在一起"。

## 根因（已确认）
**时间轴不匹配**：预览模式下传给 `SubtitleOverlay` 的 `currentTime` 曾是压缩后的 `newTimelineTime`，但 `chunks.timestamp` 是原始视频时间。

## 修复（2026-07-02）
- `SubtitleOverlay` 始终接收 `localCurrentTime`（原始时间轴）
- 预览模式下处于删除片段区间时 `visible=false`，隐藏字幕
- 已移除 `EnhancedVideoPlayer` debug fetch 埋点

## 状态
- [x] 根因确认
- [x] 最小修复
- [x] 清理 debug 埋点