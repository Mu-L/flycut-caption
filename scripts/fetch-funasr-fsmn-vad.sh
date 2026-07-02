#!/usr/bin/env bash
# 下载 FunASR FSMN VAD（中文语音活动检测）模型，打入 shared_assets
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$ROOT/src-tauri/shared_assets/funasr-fsmn-vad"
BASE_URL="https://huggingface.co/funasr/fsmn-vad-onnx/resolve/main"

mkdir -p "$DEST_DIR"

download_if_missing() {
  local name="$1"
  local dest="$DEST_DIR/$name"
  if [[ -f "$dest" ]] && [[ -s "$dest" ]]; then
    echo "[fetch-funasr-fsmn-vad] $name already present, skip"
    return 0
  fi
  echo "[fetch-funasr-fsmn-vad] downloading $name"
  curl -fsSL --connect-timeout 15 --max-time 300 -o "$dest" "$BASE_URL/$name"
}

download_if_missing "model.onnx"
download_if_missing "model_quant.onnx"
download_if_missing "vad.mvn"
download_if_missing "vad.yaml"

# funasr_onnx 期望 am.mvn / config.yaml，建立兼容副本
ln -sfn vad.mvn "$DEST_DIR/am.mvn"
cp -f "$DEST_DIR/vad.yaml" "$DEST_DIR/config.yaml"

echo "[fetch-funasr-fsmn-vad] done -> $DEST_DIR"