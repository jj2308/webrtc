const video = document.querySelector('#local'); const stat = document.querySelector('#stat')
let pc, dcMeta, ws

function waitForWsOpen () {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve()
  return new Promise(res => ws.addEventListener('open', () => res(), { once: true }))
}

async function initSignal () {
  ws = new WebSocket(`ws://${location.host}/signal`)
  await waitForWsOpen()
  ws.send(JSON.stringify({ type: 'join', role: 'pub', room: 'default' }))
  ws.onmessage = async ev => {
    const m = JSON.parse(ev.data)
    if (m.type !== 'signal' || !pc) return
    if (m.data.sdp) await pc.setRemoteDescription(m.data)
    else if (m.data.candidate) try { await pc.addIceCandidate(m.data) } catch {}
  }
}

async function start () {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },  // back camera
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 15 }
    },
    audio: false
  })
  video.srcObject = stream
  await initSignal()
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
  stream.getTracks().forEach(t => pc.addTrack(t, stream))
  dcMeta = pc.createDataChannel('meta')
  pc.onicecandidate = e => { if (e.candidate) ws.send(JSON.stringify({ type: 'signal', to: 'viewer', data: e.candidate })) }
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  ws.send(JSON.stringify({ type: 'signal', to: 'viewer', data: offer }))
  scheduleMeta()
  stat.textContent = 'Streaming (rear camera)'
}

function scheduleMeta () {
  let frame_id = 0
  function step () {
    frame_id++
    const capture_ts = Date.now()
    try { if (dcMeta && dcMeta.readyState === 'open') dcMeta.send(JSON.stringify({ frame_id, capture_ts })) } catch {}
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

document.querySelector('#startBtn').onclick = start
