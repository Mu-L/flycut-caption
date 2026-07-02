#!/usr/bin/env bash
# 字幕字体自托管：Web 用 woff2，Tauri FFmpeg 烧录用 ttf
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DEST="$ROOT/public/fonts"
TAURI_DEST="$ROOT/src-tauri/shared_assets/subtitle-fonts"

mkdir -p "$WEB_DEST/noto-sans-sc" "$WEB_DEST/inter" "$TAURI_DEST"

echo "→ 下载 Noto Sans SC (woff2 → public/fonts)..."
curl -fsSL -o "$WEB_DEST/noto-sans-sc/NotoSansSC-Regular.woff2" \
  "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@5.2.9/chinese-simplified-400-normal.woff2"
curl -fsSL -o "$WEB_DEST/noto-sans-sc/NotoSansSC-Bold.woff2" \
  "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@5.2.9/chinese-simplified-700-normal.woff2"

echo "→ 下载 Inter (woff2 → public/fonts)..."
curl -fsSL -o "$WEB_DEST/inter/Inter-Regular.woff2" \
  "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.8/latin-400-normal.woff2"
curl -fsSL -o "$WEB_DEST/inter/Inter-Bold.woff2" \
  "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.8/latin-700-normal.woff2"

echo "→ 下载 Noto Sans SC + Inter (ttf → src-tauri/shared_assets/subtitle-fonts)..."
curl -fsSL -o "$TAURI_DEST/NotoSansSC-Regular.ttf" \
  "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@5.2.9/chinese-simplified-400-normal.ttf"
curl -fsSL -o "$TAURI_DEST/NotoSansSC-Bold.ttf" \
  "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@5.2.9/chinese-simplified-700-normal.ttf"
curl -fsSL -o "$TAURI_DEST/Inter-Regular.ttf" \
  "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.8/latin-400-normal.ttf"
curl -fsSL -o "$TAURI_DEST/Inter-Bold.ttf" \
  "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.8/latin-700-normal.ttf"

echo "✓ Web 字体: public/fonts/"
echo "✓ FFmpeg 烧录字体: src-tauri/shared_assets/subtitle-fonts/"