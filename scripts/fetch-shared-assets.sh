#!/usr/bin/env bash
# 构建前拉取需打入 Tauri 安装包的共享资源（funasr-fsmn-vad + silero-vad）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

bash "$ROOT/scripts/fetch-funasr-fsmn-vad.sh"

DEST_DIR="$ROOT/src-tauri/shared_assets/silero-vad"
DEST_FILE="$DEST_DIR/silero_vad.onnx"

mkdir -p "$DEST_DIR"

if [[ -f "$DEST_FILE" ]] && [[ -s "$DEST_FILE" ]]; then
  echo "[fetch-shared-assets] silero_vad.onnx already present, skip"
  exit 0
fi

SOURCES=(
  "https://www.modelscope.cn/models/pengzhendong/silero-vad/resolve/master/silero_vad.onnx"
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"
)

for url in "${SOURCES[@]}"; do
  echo "[fetch-shared-assets] trying $url"
  if curl -fsSL --connect-timeout 15 --max-time 120 -o "$DEST_FILE" "$url"; then
    if [[ -s "$DEST_FILE" ]]; then
      echo "[fetch-shared-assets] saved $(wc -c <"$DEST_FILE" | tr -d ' ') bytes -> $DEST_FILE"
      exit 0
    fi
  fi
  rm -f "$DEST_FILE"
done

echo "[fetch-shared-assets] failed to download silero_vad.onnx" >&2
exit 1