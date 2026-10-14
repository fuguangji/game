const STORAGE_KEY = "neon-shard.custom-skin.v1";
const API = window.NEON_SHARD_API_BASE || "https://neon-shard-api.onrender.com";
const style = document.createElement("style");
style.textContent = `
#ns-tools{position:fixed;z-index:10001;right:12px;top:max(12px,env(safe-area-inset-top));display:flex;gap:6px}
.ns-btn{border:1px solid #22e6ff88;background:#07111eee;color:#d8f4ff;padding:9px 12px;font:700 12px system-ui;letter-spacing:.06em;border-radius:4px}
#ns-panel{position:fixed;z-index:10002;inset:7% 4%;max-width:620px;margin:auto;background:#07111ef5;border:1px solid #22e6ff88;color:#d8f4ff;padding:16px;display:none;overflow:auto;font:14px system-ui;box-shadow:0 0 35px #22e6ff22}
#ns-panel h2{color:#22e6ff;margin:0 0 12px}#ns-panel input,#ns-panel select{background:#101d30;color:#fff;border:1px solid #34506c;padding:10px;max-width:100%}
#ns-skin-canvas{width:min(100%,360px);aspect-ratio:1;background:#0b1424;border:1px solid #34506c;touch-action:none;display:block}
.ns-row{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.ns-status{color:#9fb6c9;white-space:pre-wrap}
`;
document.head.append(style);
let activeSocket=null;let lastMoveAt=0;\ndocument.addEventListener("pointermove",e=>{if(!activeSocket||activeSocket.readyState!==1||Date.now()-lastMoveAt<80)return;const canvas=document.querySelector("#g");if(!canvas)return;const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;lastMoveAt=Date.now();activeSocket.send(JSON.stringify({type:"move",x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height}));},{passive:true});\nconst tools=document.createElement("div");tools.id="ns-tools";
tools.innerHTML='<button class="ns-btn" id="ns-online">線上模式</button><button class="ns-btn" id="ns-skin">自訂外觀</button>';
document.body.append(tools);
const panel=document.createElement("section");panel.id="ns-panel";
panel.innerHTML='<h2 id="ns-title">NEON SHARD ONLINE</h2><div id="ns-content"></div><div class="ns-row"><button class="ns-btn" id="ns-close">關閉</button></div>';
document.body.append(panel);
const $=id=>document.getElementById(id);
const show=(title,html)=>{$("ns-title").textContent=title;$("ns-content").innerHTML=html;panel.style.display="block";};
$("ns-close").onclick=()=>{panel.style.display="none";};
function getToken(){try{return JSON.parse(sessionStorage.getItem("neonShardAuthSession")||"{}").accessToken||""}catch{return ""}}
$("ns-online").onclick=()=>{
show("線上模式",'<p>先選擇玩法與房間代碼（4–8 位英數字）。需登入帳號。</p><div class="ns-row"><select id="ns-mode"><option value="arena">競技場：弱敵人 + PvP</option><option value="boss">合作 Boss 討伐</option></select><input id="ns-code" maxlength="8" placeholder="房間代碼" value="NEON01"></div><div class="ns-row"><button class="ns-btn" id="ns-connect">連線並加入</button><button class="ns-btn" id="ns-hit">攻擊</button></div><div id="ns-status" class="ns-status">尚未連線</div><div id="ns-room"></div>');
let ws=null;
$("ns-connect").onclick=()=>{
const token=getToken();if(!token){$("ns-status").textContent="找不到登入 Token。請先登入遊戲帳號，再重試。";return}
const endpoint=API.replace(/^http/,"ws")+"/api/realtime";ws=new WebSocket(endpoint);activeSocket=ws;
ws.onopen=()=>ws.send(JSON.stringify({type:"auth",token}));
ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==="authenticated")ws.send(JSON.stringify({type:"join",mode:$("ns-mode").value,code:$("ns-code").value.trim()}));if(d.type==="error")$("ns-status").textContent=d.message;if(d.type==="room"){$("ns-status").textContent="已連線 · "+d.code+" · "+(d.mode==="boss"?"合作 Boss":"競技場");$("ns-room").textContent="玩家："+d.players.map(p=>p.name+" ("+Math.round(p.x*100)+","+Math.round(p.y*100)+")").join("、")+"\nBoss HP："+d.bossHp+"\n敵人："+(d.mobs||[]).map(m=>m.hp).join(" / ")}if(d.type==="move")$("ns-status").textContent="玩家移動同步中 · "+d.id.slice(0,8);if(d.type==="combat")$("ns-room").textContent="Boss HP："+d.bossHp+"\n敵人："+(d.mobs||[]).map(m=>m.hp).join(" / ")};
ws.onerror=()=>{$("ns-status").textContent="連線失敗：確認 API 網址、Render 服務與登入狀態。"};ws.onclose=e=>$("ns-status").textContent="連線已關閉 ("+e.code+")";
};
$("ns-hit").onclick=()=>{if(ws?.readyState===1)ws.send(JSON.stringify({type:"attack"}));};
};
$("ns-skin").onclick=()=>{
show("自訂角色外觀",'<p>在畫布上自由繪製角色圖樣。外觀僅影響本機顯示，不提供能力加成。</p><canvas id="ns-skin-canvas" width="360" height="360"></canvas><div class="ns-row"><label>筆色 <input id="ns-color" type="color" value="#22e6ff"></label><label>粗細 <input id="ns-width" type="range" min="1" max="16" value="5"></label></div><div class="ns-row"><button class="ns-btn" id="ns-undo">復原</button><button class="ns-btn" id="ns-clear">清空</button><button class="ns-btn" id="ns-save">套用外觀</button><button class="ns-btn" id="ns-remove">移除外觀</button></div><div class="ns-status">以滑鼠或手指在畫布上繪製；外觀會保存在此裝置。</div>');
const c=$("ns-skin-canvas"),ctx=c.getContext("2d");let strokes=[];let active=null;
try{strokes=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]")}catch{strokes=[]}
function paint(){ctx.fillStyle="#0b1424";ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle="#ffffff12";for(let i=0;i<=360;i+=30){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,360);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(360,i);ctx.stroke()}for(const s of strokes){ctx.strokeStyle=s.color;ctx.lineWidth=s.width;ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x*360,p.y*360):ctx.moveTo(p.x*360,p.y*360));ctx.stroke()}}
function point(e){const r=c.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
c.onpointerdown=e=>{c.setPointerCapture(e.pointerId);active={color:$("ns-color").value,width:Number($("ns-width").value),points:[point(e)]};strokes.push(active);paint()};
c.onpointermove=e=>{if(!active)return;active.points.push(point(e));paint()};c.onpointerup=c.onpointercancel=()=>{active=null};
$("ns-undo").onclick=()=>{strokes.pop();paint()};$("ns-clear").onclick=()=>{strokes=[];paint()};$("ns-save").onclick=()=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(strokes));$("ns-title").textContent="外觀已儲存"};$("ns-remove").onclick=()=>{strokes=[];localStorage.removeItem(STORAGE_KEY);paint()};paint();
};
