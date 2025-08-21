from fastapi import FastAPI,WebSocket
from fastapi.responses import JSONResponse
import numpy as np, onnxruntime as ort, base64, io, time, json
from PIL import Image
app=FastAPI()
session=None
input_name=None
def load_model():
    global session,input_name
    if session: return
    session=ort.InferenceSession('/app/../models/ssd_mobilenet_v1_10.onnx',providers=['CPUExecutionProvider'])
    input_name=session.get_inputs()[0].name
def preprocess(img):
    img=img.resize((300,300))
    x=np.asarray(img).astype(np.float32)/255.0
    if x.ndim==2: x=np.stack([x]*3,axis=-1)
    x=x[:,:,:3]
    x=np.transpose(x,(2,0,1))[None,...]
    return x
def postprocess(outputs,orig_w,orig_h,conf=0.4,iou=0.45):
    boxes=outputs[0] if isinstance(outputs,list) else outputs['boxes'] if 'boxes' in outputs else outputs
    scores=outputs[1] if isinstance(outputs,list) else outputs['scores'] if 'scores' in outputs else None
    if isinstance(outputs,list):
        boxes,scores=outputs
    boxes=np.array(boxes)[0];scores=np.array(scores)[0]
    dets=[]
    for i in range(boxes.shape[0]):
        cls=int(np.argmax(scores[i]))
        sc=float(np.max(scores[i]))
        if sc<conf or cls==0: continue
        y1,x1,y2,x2=boxes[i]
        xmin=max(0.0,float(x1));ymin=max(0.0,float(y1));xmax=min(1.0,float(x2));ymax=min(1.0,float(y2))
        dets.append([xmin,ymin,xmax,ymax,sc,cls])
    dets=nms(dets,iou)
    out=[]
    for xmin,ymin,xmax,ymax,sc,cls in dets:
        out.append({"label":str(int(cls)),"score":sc,"xmin":xmin,"ymin":ymin,"xmax":xmax,"ymax":ymax})
    return out
def nms(dets,iou=0.45):
    if not dets: return []
    dets=np.array(dets)
    x1=dets[:,0];y1=dets[:,1];x2=dets[:,2];y2=dets[:,3];scores=dets[:,4]
    areas=(x2-x1)*(y2-y1)
    idx=scores.argsort()[::-1]
    keep=[]
    while idx.size>0:
        i=idx[0];keep.append(i)
        if idx.size==1:break
        xx1=np.maximum(x1[i],x1[idx[1:]])
        yy1=np.maximum(y1[i],y1[idx[1:]])
        xx2=np.minimum(x2[i],x2[idx[1:]])
        yy2=np.minimum(y2[i],y2[idx[1:]])
        w=np.maximum(0.0,xx2-xx1);h=np.maximum(0.0,yy2-yy1)
        inter=w*h
        ovr=inter/(areas[i]+areas[idx[1:]]-inter+1e-6)
        idx=idx[1:][ovr<=iou]
    return dets[keep].tolist()
@app.get('/health')
def health(): return JSONResponse({"ok":True})
@app.websocket('/ws')
async def ws_endpoint(ws:WebSocket):
    await ws.accept()
    load_model()
    while True:
        data=await ws.receive_text()
        try: msg=json.loads(data)
        except: continue
        if msg.get('type')=='frame':
            t_recv=int(time.time()*1000)
            arr=base64.b64decode(msg['jpeg'])
            img=Image.open(io.BytesIO(arr)).convert('RGB')
            x=preprocess(img)
            t0=time.time()
            o=session.run(None,{input_name:x})
            t_inf=int(time.time()*1000)
            dets=postprocess(o,img.width,img.height)
            out={"frame_id":msg["frame_id"],"capture_ts":msg["capture_ts"],"recv_ts":t_recv,"inference_ts":t_inf,"detections":dets}
            await ws.send_text(json.dumps(out))
