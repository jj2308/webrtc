const qs = s => document.querySelector(s)
const log = m => { const el = qs('#log'); el.textContent = ((el.textContent || '') + '\n' + m).slice(-2000) }
const TARGET_FPS = 12;           // set 10..15 as needed
let lastInferTs = 0;

let MODE = new URLSearchParams(location.search).get('mode') || window.MODE || 'wasm'
qs('#modeSel').value = MODE

// state
let pc, dcMeta, ws, resolveWsReady
let inFlight = false, busy = false, bytesUp = 0, bytesDown = 0
let model = null, wasmReady = false
let clockSkewMs = 0;              // viewer_time - phone_time
const skewSamples = [];
const tmpCanvas = document.createElement('canvas')
const tmpCtx = tmpCanvas.getContext('2d')
const sendCanvas = document.createElement('canvas');
const sendCtx = sendCanvas.getContext('2d');


// dom
const video = qs('#remote'), canvas = qs('#overlay'), ctx = canvas.getContext('2d')
const stat = qs('#stat')

// frame meta for alignment
const frameMeta = new Map()

// signaling buffers
const pendingRemoteCandidates = []
const pendingLocalSignals = []

function waitForWsOpen () {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve()
  return new Promise(res => { resolveWsReady = res })
}

async function initSignal () {
  ws = new WebSocket(`ws://${location.host}/signal`)
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', role: 'viewer', room: 'default' }))
    if (resolveWsReady) resolveWsReady()
    while (pendingLocalSignals.length) ws.send(JSON.stringify(pendingLocalSignals.shift()))
  }

  // Viewer is *answerer*: respond to offer, then add ICE (buffered until SRD)
  ws.onmessage = async ev => {
    const m = JSON.parse(ev.data)
    if (m.type !== 'signal' || !pc) return

    if (m.data.sdp) {
      await pc.setRemoteDescription(m.data)

      // flush buffered ICE now that SRD is set
      while (pendingRemoteCandidates.length) {
        try { await pc.addIceCandidate(pendingRemoteCandidates.shift()) } catch (e) { console.warn('flush ICE err', e) }
      }

      // If we received an OFFER, create & send ANSWER
      if (m.data.type === 'offer') {
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        const msg = { type: 'signal', to: 'pub', data: answer }
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
        else pendingLocalSignals.push(msg)
      }
    } else if (m.data.candidate) {
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(m.data) } catch (e) { console.warn('ICE err', e) }
      } else {
        pendingRemoteCandidates.push(m.data)
      }
    }
  }
}

async function createPC () {
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
pc.ontrack = e => {
  video.srcObject = e.streams[0]
  stat.textContent = 'Streaming'
}

  pc.ondatachannel = e => { if (e.channel.label === 'meta') { dcMeta = e.channel; dcMeta.onmessage = onMeta } }
  pc.onicecandidate = e => {
    if (!e.candidate) return
    const msg = { type: 'signal', to: 'pub', data: e.candidate }
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    else pendingLocalSignals.push(msg)
  }
}

function onMeta (ev) {
  try {
    const m = JSON.parse(ev.data)
    frameMeta.set(m.frame_id, { capture_ts: m.capture_ts })
    const now = Date.now();
    const diff = now - m.capture_ts;   // positive if viewer clock ahead
    skewSamples.push(diff);
    if (skewSamples.length > 60) skewSamples.shift();
    const med = [...skewSamples].sort((a,b)=>a-b)[Math.floor(skewSamples.length/2)];
    clockSkewMs = med;

  } catch {}
}

async function connect () {
  stat.textContent = 'Connecting…'
  await initSignal()
  await waitForWsOpen()
  await createPC()
  // Viewer does NOT create an offer; waits for Publisher’s offer.
  stat.textContent = 'Waiting for Publisher…'
}

qs('#connectBtn').onclick = connect
fetch('/qr').then(r => r.blob()).then(b => qs('#qr').src = URL.createObjectURL(b))

// ---------- drawing ----------
function normToPx (x, y, w, h) { return [x * w, y * h] }
function drawDetections(dets, frame_id, capture_ts) {
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return

  // Stage size in CSS pixels
  const sw = canvas.clientWidth
  const sh = canvas.clientHeight

  // HiDPI: backbuffer matches the stage
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const needW = Math.round(sw * dpr), needH = Math.round(sh * dpr)
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width = needW; canvas.height = needH
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, sw, sh)

  // object-fit: contain → compute rendered video rect within the stage
  const scale = Math.min(sw / vw, sh / vh)
  const rw = vw * scale, rh = vh * scale
  const offX = (sw - rw) / 2, offY = (sh - rh) / 2

  // Styles scale with rendered width so label size stays nice
  const fontSize = Math.max(14, Math.round(rw * 0.02))
  ctx.lineWidth = Math.max(2, Math.round(rw * 0.0025))
  ctx.strokeStyle = 'rgba(88,162,255,0.95)'
  ctx.fillStyle = 'rgba(88,162,255,0.18)'
  ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`
  ctx.textBaseline = 'alphabetic'

  for (const d of dets) {
    // normalized → pixels in the rendered video rect
    const x1 = offX + d.xmin * rw
    const y1 = offY + d.ymin * rh
    const x2 = offX + d.xmax * rw
    const y2 = offY + d.ymax * rh
    const bw = x2 - x1, bh = y2 - y1

    ctx.strokeRect(x1, y1, bw, bh)
    ctx.fillRect(x1, y1, bw, bh)

    const text = `${d.label} ${(d.score * 100).toFixed(0)}%`
    const padX = Math.max(6, Math.round(fontSize * 0.35))
    const padY = Math.max(3, Math.round(fontSize * 0.25))
    const textW = ctx.measureText(text).width
    const labelW = textW + padX * 2
    const labelH = fontSize + padY * 2

    let lx = x1 + 2
    let ly = y1 - labelH - 2
    if (ly < 0) ly = y1 + 2
    if (lx + labelW > sw) lx = sw - labelW - 2

    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    roundRect(ctx, lx, ly, labelW, labelH, 6); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 2
    ctx.fillText(text, lx + padX, ly + padY + fontSize * 0.9)
    ctx.restore()
  }

  const overlay_display_ts = Date.now()
  metricsTrack({ frame_id, capture_ts, overlay_display_ts })
}

function roundRect(ctx, x, y, w, h, r = 6) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// ---------- wasm (coco-ssd) ----------
async function loadWasm () {
  if (wasmReady && model) return
  await tf.setBackend('wasm'); await tf.ready()
  model = await cocoSsd.load({ base: 'lite_mobilenet_v2' })
  wasmReady = true
}

async function inferWasm () {
  if (busy || !wasmReady) return
  if (!video.videoWidth || !video.videoHeight) return
  busy = true

  // Aspect-aware downscale: keep portrait/landscape correct, cap longest side.
  const MAX_SIDE = 320;                 // try 384 if you want more detail
  const scale = MAX_SIDE / Math.max(video.videoWidth, video.videoHeight)
  const w = Math.max(1, Math.round(video.videoWidth  * scale))
  const h = Math.max(1, Math.round(video.videoHeight * scale))

  if (tmpCanvas.width !== w)  tmpCanvas.width  = w
  if (tmpCanvas.height !== h) tmpCanvas.height = h
  tmpCtx.drawImage(video, 0, 0, w, h)

  const frame_id = Array.from(frameMeta.keys()).pop() || 0
  const meta = frameMeta.get(frame_id) || { capture_ts: Date.now() }
  const t0 = Date.now()

  // Run detection
  const preds = await model.detect(tmpCanvas, 20)

  // Keep only confident detections and convert to normalized coords
  const MIN_SCORE = 0.35
  const dets = preds
    .filter(p => p.score >= MIN_SCORE)
    .map(p => ({
      label: p.class, score: p.score,
      xmin: p.bbox[0] / w,
      ymin: p.bbox[1] / h,
      xmax: (p.bbox[0] + p.bbox[2]) / w,
      ymax: (p.bbox[1] + p.bbox[3]) / h
    }))

  drawDetections(dets, frame_id, meta.capture_ts)
  metricsLog({
    frame_id,
    capture_ts: meta.capture_ts,
    recv_ts: t0,
    inference_ts: Date.now(),
    detections: dets
  })

  busy = false
}
// ---------- server inference ----------
let inferSocket
function ensureInferSocket () {
  if (inferSocket && inferSocket.readyState === WebSocket.OPEN) return
  inferSocket = new WebSocket(`ws://${location.hostname}:8001/ws`)
  inferSocket.onmessage = ev => {
    bytesDown += ev.data.length || 0
    const o = JSON.parse(ev.data)
    o.from_server=true
    drawDetections(o.detections, o.frame_id, o.capture_ts)
    metricsLog(o)
  }
}

async function inferServer () {
  if (inFlight) return;
  if (!video.videoWidth || !video.videoHeight) return;
  inFlight = true;

  // Keep portrait/landscape, cap longest side (match WASM path).
  const MAX_SIDE = 320;                          // use 384 for more detail (slower)
  const scale = MAX_SIDE / Math.max(video.videoWidth, video.videoHeight);
  const w = Math.max(1, Math.round(video.videoWidth  * scale));
  const h = Math.max(1, Math.round(video.videoHeight * scale));

  if (sendCanvas.width !== w)  sendCanvas.width  = w;
  if (sendCanvas.height !== h) sendCanvas.height = h;
  sendCtx.drawImage(video, 0, 0, w, h);

  // JPEG encode
  const blob = await new Promise(r => sendCanvas.toBlob(b => r(b), 'image/jpeg', 0.6));
  const arr = await blob.arrayBuffer();
  bytesUp += arr.byteLength;

  ensureInferSocket();

  // align with the latest meta frame from the phone
  const frame_id = Array.from(frameMeta.keys()).pop() || 0;
  const meta = frameMeta.get(frame_id) || { capture_ts: Date.now() };

  const msg = {
    type: 'frame',
    frame_id,
    capture_ts: meta.capture_ts,      // send phone ts for correct E2E metrics
    jpeg: arrayBufferToBase64(arr)
  };

  // wait until WS is open
  await new Promise(res => {
    if (inferSocket.readyState === WebSocket.OPEN) return res();
    inferSocket.addEventListener('open', () => res(), { once: true });
  });

  inferSocket.send(JSON.stringify(msg));
  inFlight = false;
}

function arrayBufferToBase64 (buffer) {
  let bin = ''; const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

// ---------- metrics ----------
const metrics = { e2e: [], server: [], network: [], frames: 0 }
function metricsLog (o) {
  if (!o) return;
  const adjCapture = o.capture_ts + clockSkewMs;
  metrics.e2e.push(Date.now() - adjCapture);

  if (o.from_server) {
    metrics.server.push(o.inference_ts - o.recv_ts);
    metrics.network.push(o.recv_ts - adjCapture);
  }
  metrics.frames++;
}

function metricsTrack (_e) {}
function median (a) { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2 }
function p95 (a) { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.floor(0.95 * (b.length - 1))] }
function kbps (bytes, sec) { return sec > 0 ? ((bytes * 8) / 1000) / sec : 0 }

async function pushMetrics (duration) {
  const out = {
    duration, mode: MODE,
    median_e2e_ms: Math.round(median(metrics.e2e)), p95_e2e_ms: Math.round(p95(metrics.e2e)),
    median_server_ms: Math.round(median(metrics.server)), p95_server_ms: Math.round(p95(metrics.server)),
    median_network_ms: Math.round(median(metrics.network)), p95_network_ms: Math.round(p95(metrics.network)),
    processed_fps: Math.round(metrics.frames / Math.max(1, duration)),
    uplink_kbps: Math.round(kbps(bytesUp, duration)), downlink_kbps: Math.round(kbps(bytesDown, duration)), ts: Date.now()
  }
  await fetch('/metrics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(out) })
  // auto-download metrics.json
  const m = await fetch('/metrics.json').then(r => r.blob())
  const url = URL.createObjectURL(m); const a = document.createElement('a')
  a.href = url; a.download = 'metrics.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  stat.textContent = `FPS ${out.processed_fps} • e2e ${out.median_e2e_ms}/${out.p95_e2e_ms} ms`
}

function tick() {
  const now = performance.now();
  const MIN_INTERVAL = 1000 / TARGET_FPS;

  // Only try to start a new inference if we’re past the interval
  if (now - lastInferTs >= MIN_INTERVAL) {
    // start only if we’re not already busy/inFlight (newest-frame policy)
    if (MODE === 'wasm') {
      if (!busy) { lastInferTs = now; inferWasm(); }
    } else {
      if (!inFlight) { lastInferTs = now; inferServer(); }
    }
  }
  requestAnimationFrame(tick);
}

qs('#modeSel').onchange = e => { MODE = e.target.value }
qs('#startBench').onclick = () => startBench(30)

function startBench (dur) {
  const benchEnd = Date.now() + dur * 1000
  const t = setInterval(() => {
    const left = benchEnd - Date.now()
    stat.textContent = `Benchmark ${(Math.max(0, left / 1000)).toFixed(0)}s`
    if (left <= 0) { clearInterval(t); pushMetrics(dur) }
  }, 500)
}

window.addEventListener('load', async () => {
  const params = new URLSearchParams(location.search)
  if (params.get('auto') === '1') {
    const cfg = await fetch('/bench/config').then(r => r.json()).catch(_ => ({}))
    if (cfg.mode) MODE = cfg.mode; qs('#modeSel').value = MODE
    startBench(parseInt(cfg.duration || params.get('duration') || '30', 10))
  }
  await loadWasm()
  tick()
})
