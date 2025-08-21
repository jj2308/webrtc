# Design Report

We use a browser-to-browser WebRTC link for video, a WS signaling server, and two inference modes. Phone only needs a browser. A QR points the phone to `/publisher.html`.

**WASM mode:** Viewer runs TF.js wasm backend with `@tensorflow-models/coco-ssd` (lite mobilenet), sampling at ~15 FPS on 320×240 frames using a latest-only queue. Detections are rendered with a canvas overlay. Latency computed as `overlay_display_ts - capture_ts` (publisher provides `capture_ts` per frame through RTCDataChannel).

**Server mode:** Viewer sends JPEG-encoded 320×240 frames to a Python FastAPI WS. Server uses onnxruntime with SSD MobileNet v1 (ONNX Model Zoo). It returns detections with `recv_ts` and `inference_ts`. Viewer overlays and aggregates metrics. A busy flag enforces backpressure: if a request is in flight, the viewer drops intermediate frames and keeps only the latest.

**Low-resource:** Small input (320×240), quantized/lightweight model, single-thread ORT, dropping strategy, no GPU needed. CPU-bound processing reaches 10–15 FPS on i5/8GB class laptops.

**Backpressure:** One-slot queue both in viewer and server. Viewer sets `inFlight=true` during server calls; new frames overwrite a single `pending` slot. In wasm mode, a similar `busy` guard skips frames when inference is running.

**Frame alignment:** Publisher emits `{frame_id,capture_ts}` via RTC DataChannel on each rendered frame. Viewer pairs detections with the closest frame id and normalizes coordinates to the current video size.

**Metrics:** Viewer tracks E2E, server, and network latencies, FPS, and bandwidth. Results are posted to `/metrics` and saved as `data/metrics.json`. Benchmarking is triggered by a button, URL params, or `bench/run_bench.sh` which flags a bench session and polls for output.
