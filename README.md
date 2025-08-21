# WebRTC Multi-Object Detection Demo

This project streams a phone camera to a laptop browser via WebRTC and overlays **real-time object detections**.

- **WASM mode (default):** In-browser inference (TensorFlow.js + coco-ssd lite_mobilenet_v2).  
- **Server mode:** Python FastAPI + onnxruntime (CPU), exchanging JPEG frames over WebSocket.  

---

## 🚀 Quick Start

### 1. Clone the repo
```bash
git clone <repo> && cd webrtc-multiobj-demo
```

### 2. Start the demo
```bash
./start.sh              # defaults to WASM mode
./start.sh server       # server mode
# or:
docker compose up --build
```

### 3. Open the viewer
- On your laptop: visit [http://localhost:3000](http://localhost:3000)  
  (or `http://<LAN-IP>:3000`, e.g. `http://192.168.86.105:3000`)  
- Click **Connect**.  
- Scan the QR with your phone to open the publisher, then tap **Start** (rear camera).  

👉 You should now see the phone video mirrored on the laptop with detection overlays.

---

## 📊 Benchmarking

Run a 30-second benchmark:
```bash
./bench/run_bench.sh --duration 30 --mode wasm --host <LAN-IP>
```

- Results are saved in `data/metrics.json`.  
- The file is also served at `http://<LAN-IP>:3000/metrics.json`.  
- Alternatively, click **Start Benchmark** in the viewer UI.  

---

## 🌐 Remote Access

If your phone cannot reach the laptop directly:
```bash
./start.sh --ngrok
```
Use the printed public URL on your phone.

---

## 📂 Project Structure

- `docker-compose.yml`, `docker-compose.hotspot.yml` (optional)  
- `start.sh` – convenience launcher  
- `frontend/` – Express server (signaling + static UI)  
- `backend/` – FastAPI inference service (server mode, `ws://<host>:8001/ws`)  
- `bench/run_bench.sh` – benchmarking script  
- `report.md` – design notes  
- `data/metrics.json` – benchmark results  

---

## 📝 Implementation Notes

- **Low-resource defaults:**  
  - Aspect-aware downscale to max side = 320 px  
  - Target 10–15 FPS  
  - Newest-frame backpressure (drops stale frames)  

- **Frame alignment:**  
  - Phone sends `{frame_id, capture_ts}`  
  - Detections use normalized `[0..1]` coordinates  

- **Bandwidth reporting:**  
  - **Server mode:** counts JPEG bytes up/down  
  - **WASM mode:** reports `0` (no network latency)  
# webrtc
