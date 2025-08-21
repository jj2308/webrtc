# Real-time WebRTC Multi-Object Detection — Short Report

## 1) Overview & goals
- **Goal:** Stream a phone camera to a laptop browser via WebRTC and overlay real-time multi-object detections with a one-command start.
- **Constraints:** Must run on modest laptops (Intel i5, 8 GB, no GPU), target **10–15 FPS**, include **WASM** (on-device) and **Server** inference modes, and produce **metrics.json** with median/P95 latencies and FPS.

---

## 2) Architecture

```
Phone (Publisher) ─── WebRTC (video) ──► Viewer (Answerer, Browser)
         │                                 │
         └── DataChannel: {frame_id, capture_ts}  ──►  alignment/metrics
                                         └── Inference:
                                              - WASM (tfjs-wasm + coco-ssd)
                                              - Server (WS jpeg → ORT CPU → WS detections)
```

- **Signaling:** lightweight WebSocket (`/signal`) with rooms; viewer is **answerer**.  
- **Video path:** pure WebRTC (STUN: `stun:stun.l.google.com:19302`).  
- **Metadata path:** DataChannel `"meta"` from phone → viewer to carry `frame_id` & `capture_ts`.  
- **Server mode:** viewer downsamples to JPEG (max-side 320) and sends to backend WS (`/ws`); backend returns detections.

---

## 3) Inference modes

### WASM mode (default, low-resource)
- **Model:** `coco-ssd` (lite_mobilenet_v2) via **tfjs-wasm**.
- **Preprocess:** aspect-aware downscale to **max-side 320 px** (not a hard 320×240), which preserves portrait/landscape and reduces CPU.
- **Throughput:** ~10–15 FPS on i5/8 GB with throttling and frame dropping (see §5).

### Server mode
- **Backend:** Python FastAPI (or Node) + **onnxruntime CPU**.  
- **Protocol:** viewer → WS → `{type:'frame', frame_id, capture_ts, jpeg}`; backend returns  
  `{frame_id, capture_ts, recv_ts, inference_ts, detections:[...]}`.  
- **Why JPEG:** simple, portable, robust on CPUs; small and consistent payloads aid fairness for low-resource machines.

---

## 4) Frame alignment & API contract
- **Phone → Viewer (DataChannel):** `{ frame_id, capture_ts }` for every camera frame.  
- **Detections:** normalized coordinates `[0..1]` → viewer converts to pixels using the **rendered video rect** (letterbox-aware) so overlays stay aligned for both portrait and landscape.  
- **Clock skew:** viewer estimates median skew over the last N samples (`viewer_now - capture_ts`) and **adjusts `capture_ts`** when computing e2e latency.

---

## 5) Low-resource strategy
- **Downscale:** aspect-aware to **max-side 320** (288/256 if needed).  
- **Throttled processing:** viewer runs inference at `TARGET_FPS≈12` (10–15 window).  
- **Fast NMS/filters:** limit to top-K (e.g., 10–20) and drop low-score boxes (`score ≥ 0.35`).  
- **WASM optimizations:** `tfjs-wasm` backend; optional COOP/COEP headers for threads/SIMD when available.  
- **UI efficiency:** single canvas overlay, HiDPI aware; dynamic label sizing for readability without reflow.

---

## 6) Backpressure policy (frame dropping)
- **Newest-frame policy:**  
  - **WASM:** a `busy` flag guards `inferWasm()`. If a new frame arrives while busy, it **skips** older frames and always processes the **latest** one.  
  - **Server:** an `inFlight` flag ensures only one JPEG is being sent; new frames **replace** pending work.  
- **Why:** minimizes latency buildup and avoids spiraling queues on low-end CPUs. Prioritizing *freshness* gives better UX than maximizing total processed frames.

---

## 7) Metrics & measurement
- **E2E latency:** `overlay_display_ts - capture_ts (skew-corrected)`; report **median** and **P95**.  
- **Server latency:** `inference_ts - recv_ts`.  
- **Network latency (server mode):** `recv_ts - capture_ts`.  
- **Processed FPS:** `frames_processed / duration`.  
- **Bandwidth:** byte counters for WS traffic (server mode) and optional `RTCRtpSender/Receiver getStats()` sampler for WebRTC video bitrate.  
- **Output:** auto-downloaded **`metrics.json`** and also served at `/metrics.json`.

---

## 8) Robustness & UX
- **QR onboarding:** viewer serves a QR that encodes the publisher URL; no phone app required.  
- **Orientation safe:** overlay math uses letterboxed render size; labels remain readable.  
- **Networking:** bind to `0.0.0.0`, optional `docker-compose.hotspot.yml` to pin to a specific LAN IP; `--ngrok` for NAT.

---

## 9) Trade-offs & next steps
- **Model choice:** COCO-SSD is light and fast but misses small/rare objects.  
  **Next:** quantized **YOLOv5n / YOLOv8n** via onnxruntime-web (WASM SIMD/threads) for better recall at ~10–12 FPS.  
- **Server pipeline:** JPEG hop is simple; **next** would be zero-copy tensor paths or RTP-encoded tiles for lower latency on CPUs.  
- **Adaptive policy:** dynamically tune `TARGET_FPS`/`max-side` based on moving average of inference time to hold ~12 FPS under varying load.

---

**Result:** The demo meets the acceptance criteria—phone connects via QR/URL, live overlays are shown, metrics.json exists with median & P95 latency and FPS, and both WASM and Server modes run on low-resource hardware with a clear backpressure policy.
