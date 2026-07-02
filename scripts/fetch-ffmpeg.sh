#!/usr/bin/env bash
# 下载当前平台的静态 FFmpeg 到 src-tauri/binaries/（打入 Tauri 安装包）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/binaries"
mkdir -p "$DEST"

OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$OS" == "MINGW"* || "$OS" == "MSYS"* || "$OS" == "CYGWIN"* ]]; then
  PLATFORM="windows-x86_64"
  OUT_NAME="ffmpeg.exe"
else
  OUT_NAME="ffmpeg"
  case "$OS-$ARCH" in
    Darwin-arm64|Darwin-aarch64) PLATFORM="macos-arm64" ;;
    Darwin-x86_64) PLATFORM="macos-x86_64" ;;
    Linux-x86_64|Linux-amd64) PLATFORM="linux-x86_64" ;;
    Linux-aarch64|Linux-arm64) PLATFORM="linux-arm64" ;;
    *)
      echo "[fetch-ffmpeg] unsupported platform: $OS $ARCH" >&2
      exit 1
      ;;
  esac
fi

OUT_PATH="$DEST/$OUT_NAME"

if [[ -f "$OUT_PATH" ]] && [[ -x "$OUT_PATH" ]]; then
  echo "[fetch-ffmpeg] $OUT_NAME already present, skip"
  "$OUT_PATH" -version | head -1
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BTBN_BASE="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"

echo "[fetch-ffmpeg] platform=$PLATFORM"

case "$PLATFORM" in
  macos-arm64|macos-x86_64)
    curl -fsSL --connect-timeout 30 --max-time 300 \
      "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip" -o "$TMP/ffmpeg.zip"
    unzip -q -o "$TMP/ffmpeg.zip" -d "$TMP"
    install -m 755 "$TMP/ffmpeg" "$OUT_PATH"
    ;;
  linux-x86_64)
    curl -fsSL --connect-timeout 30 --max-time 300 \
      "$BTBN_BASE/ffmpeg-master-latest-linux64-gpl.tar.xz" -o "$TMP/ffmpeg.tar.xz"
    tar -xJf "$TMP/ffmpeg.tar.xz" -C "$TMP"
    FFMPEG_BIN="$(find "$TMP" -type f -name ffmpeg -path '*/bin/ffmpeg' | head -1)"
    [[ -n "$FFMPEG_BIN" ]] || { echo "[fetch-ffmpeg] ffmpeg binary not found in archive" >&2; exit 1; }
    install -m 755 "$FFMPEG_BIN" "$OUT_PATH"
    ;;
  linux-arm64)
    curl -fsSL --connect-timeout 30 --max-time 300 \
      "$BTBN_BASE/ffmpeg-master-latest-linuxarm64-gpl.tar.xz" -o "$TMP/ffmpeg.tar.xz"
    tar -xJf "$TMP/ffmpeg.tar.xz" -C "$TMP"
    FFMPEG_BIN="$(find "$TMP" -type f -name ffmpeg -path '*/bin/ffmpeg' | head -1)"
    [[ -n "$FFMPEG_BIN" ]] || { echo "[fetch-ffmpeg] ffmpeg binary not found in archive" >&2; exit 1; }
    install -m 755 "$FFMPEG_BIN" "$OUT_PATH"
    ;;
  windows-x86_64)
    curl -fsSL --connect-timeout 30 --max-time 300 \
      "$BTBN_BASE/ffmpeg-master-latest-win64-gpl.zip" -o "$TMP/ffmpeg.zip"
    unzip -q -o "$TMP/ffmpeg.zip" -d "$TMP"
    FFMPEG_BIN="$(find "$TMP" -type f -name ffmpeg.exe -path '*/bin/ffmpeg.exe' | head -1)"
    [[ -n "$FFMPEG_BIN" ]] || { echo "[fetch-ffmpeg] ffmpeg.exe not found in archive" >&2; exit 1; }
    install -m 755 "$FFMPEG_BIN" "$OUT_PATH"
    ;;
esac

if [[ "$OS" == "Darwin" ]]; then
  xattr -cr "$OUT_PATH" 2>/dev/null || true
fi

chmod +x "$OUT_PATH"
echo "[fetch-ffmpeg] installed -> $OUT_PATH"
"$OUT_PATH" -version | head -1