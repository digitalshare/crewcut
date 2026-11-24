// Web: production board (/ and /p/:id), three.js set preview (/set/:id), static files (/files/:id/*), JSON (/api/:id).
import "dotenv/config";
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { ROOT, load } from "./production.js";
import { PORT } from "./share.js";

const MIME: Record<string, string> = { ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".glb": "model/gltf-binary", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (parts[0] === "api" && parts[1]) {
      const p = await load(parts[1]);
      if (!p) return send(res, 404, "not found");
      return send(res, 200, JSON.stringify(p), "application/json");
    }
    if (parts[0] === "api") {
      const ids = (await readdir(ROOT).catch(() => [])).filter((x) => !x.startsWith(".")).sort().reverse();
      return send(res, 200, JSON.stringify(ids), "application/json");
    }
    if (parts[0] === "files" && parts.length >= 3) {
      const f = normalize(join(ROOT, ...parts.slice(1)));
      if (!f.startsWith(ROOT) || !existsSync(f)) return send(res, 404, "not found");
      return stream(req, res, f);
    }
    if (parts[0] === "set" && parts[1]) return send(res, 200, SET_HTML(parts[1]), "text/html");
    if (parts[0] === "p" && parts[1]) return send(res, 200, BOARD_HTML(parts[1]), "text/html");
    if (!parts.length) return send(res, 200, INDEX_HTML, "text/html");
    send(res, 404, "not found");
  } catch (e) {
    send(res, 500, String(e));
  }
}).listen(PORT, () => console.log(`Crewcut web on http://localhost:${PORT}`));

function send(res: any, code: number, body: string, type = "text/plain") {
  res.writeHead(code, { "Content-Type": type + "; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

// Range support so <video> can seek.
function stream(req: any, res: any, f: string) {
  const size = statSync(f).size;
  const type = MIME[extname(f)] ?? "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? +range[2] : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    return createReadStream(f, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
  createReadStream(f).pipe(res);
}

const STYLE = `
:root{--bg:#0e0d0c;--panel:#181614;--line:#2a2724;--text:#ece6dc;--muted:#9a9187;--accent:#e8b04a;--ok:#7fb27f;--bad:#d9705c}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#f6f2ea;--panel:#fffdf8;--line:#e2dacb;--text:#1d1a16;--muted:#6f675c;--accent:#b07a12;--ok:#3f7a3f;--bad:#b0412c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 "Inter",system-ui,sans-serif}
a{color:var(--accent)}h1,h2{font-family:"Fraunces",Georgia,serif;font-weight:600;letter-spacing:-.01em;margin:0}
.wrap{max-width:1180px;margin:0 auto;padding:24px 16px 64px}
.top{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:20px}
.brand{font-family:"Fraunces",Georgia,serif;font-size:14px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
.pill{display:inline-block;padding:2px 10px;border:1px solid var(--line);border-radius:99px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.pill.live{color:var(--accent);border-color:var(--accent)}
.grid{display:grid;grid-template-columns:2fr 1fr;gap:20px}@media(max-width:860px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.shot img,.shot video{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#000;display:block}
.shot .ph{width:100%;aspect-ratio:16/9;border-radius:6px;background:repeating-linear-gradient(45deg,var(--line) 0 8px,transparent 8px 16px);display:grid;place-items:center;color:var(--muted);font-size:12px}
.shot p{margin:8px 0 0;font-size:13px;color:var(--muted)}.shot b{color:var(--text)}
.vo{font-style:italic;color:var(--text)!important}
.log{max-height:520px;overflow:auto;font-size:13px}.log div{padding:6px 0;border-bottom:1px solid var(--line);white-space:pre-wrap}
.log .a{color:var(--accent);font-weight:600}
.final video{width:100%;border-radius:8px;background:#000}
.stages{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 0}.stages span{font-size:11px;padding:2px 8px;border-radius:4px;background:var(--line);color:var(--muted)}
.stages span.on{background:var(--accent);color:#111}.stages span.done{color:var(--ok)}
`;
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;600&display=swap" rel="stylesheet">`;

const INDEX_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Crewcut</title>${FONTS}<style>${STYLE}</style></head>
<body><div class="wrap"><div class="top"><div><div class="brand">Crewcut</div><h1>Productions</h1></div></div><div id="list" class="shots"></div></div>
<script>
fetch('/api').then(r=>r.json()).then(async ids=>{const el=document.getElementById('list');
for(const id of ids){const p=await fetch('/api/'+id).then(r=>r.json());const img=p.script?.shots?.[0]?.frameURL;
el.insertAdjacentHTML('beforeend','<a class="card shot" style="text-decoration:none;color:inherit" href="/p/'+id+'">'+(img?'<img src="'+img+'">':'<div class="ph">writing…</div>')+'<p><b>'+(p.script?.title||p.pitch)+'</b><br>'+p.stage+'</p></a>')}});
</script></body></html>`;

const BOARD_HTML = (id: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Crewcut Board</title>${FONTS}<style>${STYLE}</style></head>
<body><div class="wrap">
<div class="top"><div><div class="brand">Crewcut · Production board</div><h1 id="title">…</h1><div id="logline" style="color:var(--muted)"></div><div class="stages" id="stages"></div></div>
<div><a href="/set/${id}">Open 3D set →</a></div></div>
<div class="grid"><div>
<div class="card final" id="final" style="display:none;margin-bottom:20px"><h2 style="margin-bottom:10px">Final cut</h2><video id="finalv" controls playsinline></video></div>
<div class="card"><h2 style="margin-bottom:12px">Shots</h2><div class="shots" id="shots"></div></div>
</div><div class="card"><h2 style="margin-bottom:8px">Crew chatter</h2><div class="log" id="log"></div></div></div></div>
<script>
const STAGES=["writing","storyboard","review","filming","sound","editing","done"];
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let lastLog=-1,lastShots='';
async function tick(){const p=await fetch('/api/${id}').then(r=>r.json()).catch(()=>null);if(!p)return;
document.getElementById('title').textContent=p.script?.title||p.pitch;document.getElementById('logline').textContent=p.script?.logline||'';
const si=STAGES.indexOf(p.stage);document.getElementById('stages').innerHTML=STAGES.map((s,i)=>'<span class="'+(i<si?'done':i===si?'on':'')+'">'+s+'</span>').join('')+(p.stage==='failed'?'<span style="background:var(--bad);color:#fff">failed</span>':'');
const shotsKey=JSON.stringify(p.script?.shots||[]);if(shotsKey!==lastShots){lastShots=shotsKey;
document.getElementById('shots').innerHTML=(p.script?.shots||[]).map(s=>'<div class="shot">'+(s.clipURL?'<video src="'+s.clipURL+'" muted loop autoplay playsinline poster="'+(s.frameURL||'')+'"></video>':s.frameURL?'<img src="'+s.frameURL+'">':'<div class="ph">drawing…</div>')+'<p><b>Shot '+s.id+'</b> '+esc(s.description)+'</p>'+(s.narration?'<p class="vo">“'+esc(s.narration)+'”</p>':'')+'</div>').join('')}
if(p.log.length-1!==lastLog){lastLog=p.log.length-1;const L=document.getElementById('log');L.innerHTML=p.log.slice().reverse().map(e=>'<div><span class="a">'+esc(e.agent)+'</span> '+esc(e.text)+'</div>').join('')}
if(p.finalPath){const f=document.getElementById('final');if(f.style.display==='none'){f.style.display='';const v=document.getElementById('finalv');v.poster=p.script?.shots?.[0]?.frameURL||'';v.src='/files/${id}/final.mp4'}}}
tick();setInterval(tick,2000);
</script></body></html>`;

const SET_HTML = (id: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Crewcut Set</title>${FONTS}<style>${STYLE}
html,body{height:100%}#c{position:fixed;inset:0}.hud{position:fixed;left:16px;top:16px;right:16px;pointer-events:none}.hud .card{display:inline-block;pointer-events:auto;max-width:420px;background:color-mix(in srgb,var(--panel) 88%,transparent)}
.hud ul{margin:8px 0 0;padding-left:18px;font-size:13px;color:var(--muted)}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script></head>
<body><canvas id="c"></canvas><div class="hud"><div class="card"><div class="brand">Crewcut · 3D set</div><h2 id="t">Loading set…</h2><div id="loc" style="font-size:13px;color:var(--muted)"></div><ul id="props"></ul><div style="font-size:12px;color:var(--muted);margin-top:8px">Drag to orbit · scroll to zoom · <a href="/p/${id}" style="pointer-events:auto">board</a></div></div></div>
<script type="module">
import * as THREE from 'three';import {OrbitControls} from 'three/addons/controls/OrbitControls.js';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
const canvas=document.getElementById('c');const r=new THREE.WebGLRenderer({canvas,antialias:true});r.setPixelRatio(devicePixelRatio);r.toneMapping=THREE.ACESFilmicToneMapping;r.shadowMap.enabled=true;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x15130f);scene.fog=new THREE.Fog(0x15130f,8,22);
scene.environment=new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(),0.04).texture;
const cam=new THREE.PerspectiveCamera(40,1,0.1,100);cam.position.set(0,2.6,7.5);const ctl=new OrbitControls(cam,canvas);ctl.target.set(0,0.6,0);ctl.enableDamping=true;ctl.autoRotate=true;ctl.autoRotateSpeed=0.6;
const key=new THREE.SpotLight(0xffd9a0,60,30,0.6,0.5);key.position.set(4,6,4);key.castShadow=true;scene.add(key);scene.add(new THREE.HemisphereLight(0x8899ff,0x221100,0.6));
const floor=new THREE.Mesh(new THREE.CircleGeometry(6,64),new THREE.MeshStandardMaterial({color:0x2a2620,roughness:0.9}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
scene.add(new THREE.GridHelper(12,24,0x3a352d,0x24211c));
function resize(){r.setSize(innerWidth,innerHeight);cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix()}addEventListener('resize',resize);resize();
const loader=new GLTFLoader();const loaded=new Set();
async function poll(){const p=await fetch('/api/${id}').then(r=>r.json()).catch(()=>null);if(!p?.script)return;
document.getElementById('t').textContent=p.script.title;document.getElementById('loc').textContent=p.script.location;
document.getElementById('props').innerHTML=p.script.props.map(x=>'<li>'+x.name+' — '+(x.glbURL?'✔ in 3D':x.error?'✖ failed':'modelling…')+'</li>').join('');
for(const pr of p.script.props){if(!pr.glbURL||loaded.has(pr.name))continue;loaded.add(pr.name);
const file='/files/${id}/prop-'+pr.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.glb';
loader.load(file,g=>place(g,pr),undefined,()=>loader.load(pr.glbURL,g=>place(g,pr)))}}
const props=[];
function place(g,pr){const o=g.scene;const box=new THREE.Box3().setFromObject(o);const size=box.getSize(new THREE.Vector3());
const target=Math.min(1.6,Math.max(0.5,(pr.scale||1)*2.2));const s=target/Math.max(size.x,size.y,size.z);
o.scale.setScalar(s);const b2=new THREE.Box3().setFromObject(o);const c=b2.getCenter(new THREE.Vector3());o.position.x-=c.x;o.position.z-=c.z;o.position.y-=b2.min.y;
const grp=new THREE.Group();grp.add(o);const [x,,z]=pr.position||[0,0,0];grp.position.set(x*1.3,0,z*1.3);grp.rotation.y=pr.rotationY||0;
o.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true}});scene.add(grp);props.push(grp);
const t0=performance.now();(function grow(){const k=Math.min(1,(performance.now()-t0)/700);grp.scale.setScalar(0.01+0.99*(1-Math.pow(1-k,3)));if(k<1)requestAnimationFrame(grow);else frame()})()}
// Auto-frame the camera on everything placed so far.
function frame(){const b=new THREE.Box3();props.forEach(p=>b.expandByObject(p));if(b.isEmpty())return;
const c=b.getCenter(new THREE.Vector3()),sz=b.getSize(new THREE.Vector3());const r=Math.max(sz.x,sz.y,sz.z)*0.5+0.6;
const dist=r/Math.sin(THREE.MathUtils.degToRad(cam.fov/2))*0.9;ctl.target.copy(c);
const dir=cam.position.clone().sub(c).normalize();if(dir.y<0.25){dir.y=0.35;dir.normalize()}cam.position.copy(c).addScaledVector(dir,dist)}
poll();setInterval(poll,3000);
(function loop(){ctl.update();r.render(scene,cam);requestAnimationFrame(loop)})();
</script></body></html>`;
