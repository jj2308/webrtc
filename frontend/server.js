import express from 'express'
import http from 'http'
import {WebSocketServer} from 'ws'
import bodyParser from 'body-parser'
import QRCode from 'qrcode'
import path from 'path'
import cors from 'cors'
import fs from 'fs'
const app=express()
const server=http.createServer(app)
const wss=new WebSocketServer({server,path:'/signal'})
app.disable('x-powered-by')
app.use(cors())
app.use(bodyParser.json({limit:'10mb'}))
const DATA_DIR=path.join(process.cwd(),'../data')
const PUBLIC_DIR=path.join(process.cwd(),'public')
try{fs.mkdirSync(DATA_DIR,{recursive:true})}catch{}
app.get('/env.js',(_req,res)=>{res.type('js').send(`window.MODE='${process.env.MODE||'wasm'}'`) })
app.get('/qr',async(req,res)=>{const url=`${req.protocol}://${req.get('host')}/publisher.html`;const png=await QRCode.toBuffer(url,{margin:1,width:256});res.type('png').send(png)})
app.get('/bench/start',(req,res)=>{const cfg={mode:req.query.mode||'wasm',duration:parseInt(req.query.duration||'30',10),auto:1,started:Date.now()};fs.writeFileSync(path.join(DATA_DIR,'bench.json'),JSON.stringify(cfg));res.json({ok:true})})
app.get('/bench/config',(_req,res)=>{try{const cfg=JSON.parse(fs.readFileSync(path.join(DATA_DIR,'bench.json'),'utf-8'));res.json(cfg)}catch{res.json({})}})
app.post('/metrics',(req,res)=>{try{fs.writeFileSync(path.join(DATA_DIR,'metrics.json'),JSON.stringify(req.body,null,2));res.json({ok:true})}catch(e){res.status(500).json({ok:false,error:String(e)})}})
app.get('/metrics.json',(_req,res)=>{try{res.type('json').send(fs.readFileSync(path.join(DATA_DIR,'metrics.json'),'utf-8'))}catch{res.json({})}})
app.use(express.static(PUBLIC_DIR,{etag:false,cacheControl:false}))
server.listen(3000)
const rooms=new Map()
wss.on('connection',ws=>{
  ws.on('message',m=>{
    let msg;try{msg=JSON.parse(m)}catch{return}
    if(msg.type==='join'){ws.role=msg.role;ws.room=msg.room||'default';if(!rooms.has(ws.room))rooms.set(ws.room,{pub:null,viewer:null});const r=rooms.get(ws.room);if(ws.role==='pub')r.pub=ws;else r.viewer=ws;return}
    if(msg.type==='signal'){const r=rooms.get(ws.room||'default');const peer=(msg.to==='viewer')?r.viewer:r.pub;if(peer&&peer.readyState===1){peer.send(JSON.stringify({type:'signal',data:msg.data,from:ws.role}))}}
  })
  ws.on('close',()=>{
    if(ws.room&&rooms.has(ws.room)){const r=rooms.get(ws.room);if(r.pub===ws)r.pub=null;if(r.viewer===ws)r.viewer=null}
  })
})
