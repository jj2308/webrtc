#!/usr/bin/env bash
set -e
MODE="wasm"
for arg in "$@"; do
  case $arg in
    --mode=*) MODE="${arg#*=}"; shift;;
  esac
done
export MODE
mkdir -p data models
MODEL_URL_ONNX="https://github.com/onnx/models/raw/main/vision/object_detection_segmentation/ssd-mobilenetv1/model/ssd_mobilenet_v1_10.onnx"
if [ ! -f models/ssd_mobilenet_v1_10.onnx ]; then
  echo "Downloading ONNX model..."
  curl -L "$MODEL_URL_ONNX" -o models/ssd_mobilenet_v1_10.onnx || true
fi
echo "Starting containers MODE=$MODE"
docker compose up --build -d
echo "Open http://localhost:3000 on your laptop. Scan the QR to open the phone publisher."
