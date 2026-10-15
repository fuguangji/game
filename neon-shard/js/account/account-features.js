import { G } from "../core/game-state.js";

const SKIN_KEY = "neon-shard.custom-skin.v1";
const API = window.NEON_SHARD_API_BASE || "https://neon-shard-api.onrender.com";
const CSS = `
.ns-features{display:grid;gap:14px;margin-top:14px}
.ns-feature-card{display:grid;gap:10px;padding:14px;border:1px solid #ffffff20;border-radius:12px;background:linear-gradient(145deg,#0d1725,#090e18)}
.ns-feature-card h3{margin:0;color:var(--t);font-size:1.05rem}
.ns-feature-help{margin:0;color:var(--sub,#9aaec1);font-size:.9rem;line-height:1.55}
.ns-feature-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ns-feature-row input,.ns-feature-row select{max-width:100%;min-width:0;padding:10px;border:1px solid #ffffff30;border-radius:8px;background:#101923;color:var(--t);font:inherit}
.ns-feature-btn{padding:10px 13px;border:1px solid #22e6ff70;border-radius:8px;background:#101d2b;color:var(--t);font:inherit;font-weight:700}
.ns-feature-btn.primary{background:#123548;border-color:#22e6ff}
.ns-feature-status{margin:0;color:#a8bfd2;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.9rem}
.ns-skin-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.ns-skin-canvas{display:block;width:min(100%,360px);aspect-ratio:1;background:#070d18;border:1px solid #38506a;border-radius:10px;touch-action:none}
.ns-skin-tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.ns-skin-tools label{display:flex;gap:7px;align-items:center;font-size:.9rem;color:var(--t)}
.ns-skin-tools input[type=color]{width:46px;height:38px;padding:2px;cursor:pointer}
.ns-skin-tools input[type=range]{width:120px;padding:0}
.ns-role-aura{display:inline-flex;align-items:center;gap:8px;font-size:.85rem;color:var(--sub,#9aaec1)}
.ns-role-dot{width:10px;height:10px;border-radius:50%;display:inline-block;box-shadow:0 0 12px currentColor}
@media(min-width:620px){.ns-skin-layout{grid-template-columns:minmax(0,360px) minmax(0,1fr);align-items:start}}
`;
function addStyle(){if(!document.getElementById("ns-account-features-css")){const s=document.createElement("style");s.id="ns-account-features-css";s.textContent=CSS;document.head.append(s)}}
function el(tag,attrs={},text=""){const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==="class")n.className=v;else if(k.startsWith("on")&&typeof v==="function")n.addEventListener(k.slice(2),v);else if(v!==undefined&&v!==null)n.setAttribute(k,String(v))}if(text)n.textContent=text;return n}
function button(label,fn,primary=false){const b=el("button",{type:"button",class:"ns-feature-btn"+(primary?" primary":"")},label);b.addEventListener("click",fn);return b}
function roleColor(){const c=G.CHR?.c;return typeof c==="string"&&/^#[0-9a-f]{6}$/i.test(c)?c:"#22e6ff"}
function getToken(){try{const s=JSON.parse(sessionStorage.getItem("neonShardAuthSession")||"null");return typeof s?.accessToken==="string"?s.accessToken:""}catch{return ""}}

export function mountAccountFeatures(container){
 addStyle();
 let socket=null, strokes=[], activeStroke=null, lastMove=0, destroyed=false;
 const root=el("section",{class:"ns-features"});
 const account=el("section",{class:"ns-feature-card"});
 account.append(el("h3",{},"角色外觀設計"));
 const roleLabel=el("div",{class:"ns-role-aura"});
 const roleDot=el("span",{class:"ns-role-dot"});
 const roleText=el("span",{},"職業代表色粒子光環");
 roleLabel.append(roleDot,roleText);
 account.append(roleLabel,el("p",{class:"ns-feature-help"},"選擇任意筆色並在畫布上繪製；每一筆都會保留自己的顏色。套用後會顯示在遊戲角色上，角色周圍粒子使用目前職業的代表色。"));
 const canvas=el("canvas",{class:"ns-skin-canvas",width:360,height:360,"aria-label":"角色外觀繪圖畫布"});
 const ctx=canvas.getContext("2d");
 const tools=el("div",{class:"ns-skin-tools"});
 const colorLabel=el("label",{},"筆色");
 const color=el("input",{type:"color",value:"#ff4dff","aria-label":"筆刷顏色"});
 colorLabel.append(color);
 const widthLabel=el("label",{},"粗細");
 const width=el("input",{type:"range",min:1,max:20,value:5,"aria-label":"筆刷粗細"});
 widthLabel.append(width);
 tools.append(colorLabel,widthLabel);
 const actions=el("div",{class:"ns-feature-row"});
 const skinStatus=el("p",{class:"ns-feature-status"},"外觀只影響造型，不會增加戰鬥能力。");
 actions.append(button("復原",()=>{strokes.pop();paint()}),button("清空",()=>{strokes=[];paint()}),button("套用外觀",()=>{try{localStorage.setItem(SKIN_KEY,JSON.stringify(strokes));skinStatus.textContent="已套用！回到戰鬥即可看到自訂外觀。"}catch{skinStatus.textContent="儲存失敗，請檢查瀏覽器儲存空間。"}} ,true),button("移除外觀",()=>{strokes=[];localStorage.removeItem(SKIN_KEY);paint();skinStatus.textContent="已移除自訂外觀。"}));
 let initial=[];try{initial=JSON.parse(localStorage.getItem(SKIN_KEY)||"[]")}catch{}
 strokes=Array.isArray(initial)?initial:[];
 function paint(){
  ctx.clearRect(0,0,360,360);ctx.fillStyle="#070d18";ctx.fillRect(0,0,360,360);
  ctx.strokeStyle="#ffffff12";ctx.lineWidth=1;
  for(let i=0;i<=360;i+=30){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,360);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(360,i);ctx.stroke()}
  const base=roleColor();
  ctx.save();ctx.shadowColor=base;ctx.shadowBlur=18;ctx.fillStyle=base+"22";ctx.strokeStyle=base;ctx.lineWidth=3;ctx.beginPath();ctx.arc(180,180,145,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
  for(const s of strokes){if(!Array.isArray(s.points)||!s.points.length)continue;ctx.beginPath();ctx.strokeStyle=/^#[0-9a-f]{6}$/i.test(s.color)?s.color:"#ff4dff";ctx.lineWidth=Math.max(1,Math.min(20,Number(s.width)||5));ctx.lineCap="round";ctx.lineJoin="round";s.points.forEach((p,i)=>{const x=Math.max(0,Math.min(1,p.x))*360,y=Math.max(0,Math.min(1,p.y))*360;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});if(s.points.length===1){const p=s.points[0];ctx.lineTo(p.x*360+.1,p.y*360+.1)}ctx.stroke()}
 }
 function point(e){const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
 canvas.addEventListener("pointerdown",e=>{e.preventDefault();canvas.setPointerCapture(e.pointerId);activeStroke={color:color.value,width:Number(width.value),points:[point(e)]};strokes.push(activeStroke);paint()});
 canvas.addEventListener("pointermove",e=>{if(!activeStroke)return;e.preventDefault();activeStroke.points.push(point(e));paint()});
 const finish=()=>{activeStroke=null};canvas.addEventListener("pointerup",finish);canvas.addEventListener("pointercancel",finish);
 color.addEventListener("input",()=>{colorLabel.style.color=color.value});
 account.append(canvas,tools,actions,skinStatus);
 const online=el("section",{class:"ns-feature-card"});
 online.append(el("h3",{},"線上聯機"));
 online.append(el("p",{class:"ns-feature-help"},"選擇競技場或合作 Boss，輸入相同房間代碼即可加入同一房間。需要先登入遊戲帳號。"));
 const row=el("div",{class:"ns-feature-row"});
 const mode=el("select",{"aria-label":"遊戲模式"});
 const arenaOption=el("option",{value:"arena"},"競技場：弱敵人 + PvP");const bossOption=el("option",{value:"boss"},"合作 Boss 討伐");mode.append(arenaOption,bossOption);
 const code=el("input",{maxlength:8,placeholder:"房間代碼（4–8 位英數字）",value:"NEON01","aria-label":"房間代碼"});
 row.append(mode,code);
 const connect=button("連線並加入",connectRoom,true),attack=button("攻擊",()=>send({type:"attack"}));
 const disconnect=button("中斷連線",()=>{socket?.close(1000,"user disconnect");socket=null;setStatus("已中斷連線。")});
 const onlineActions=el("div",{class:"ns-feature-row"});onlineActions.append(connect,attack,disconnect);
 const status=el("p",{class:"ns-feature-status"},"尚未連線");
 const room=el("p",{class:"ns-feature-status"},"");
 online.append(row,onlineActions,status,room);
 root.append(account,online);
 container.replaceChildren(root);
 function setStatus(s){status.textContent=s}
 function send(d){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(d));else setStatus("尚未連線。")}
 function connectRoom(){
  const token=getToken();if(!token){setStatus("尚未登入或登入工作階段已過期，請重新登入。");return}
  const roomCode=code.value.trim().toUpperCase();if(!/^[A-Z0-9]{4,8}$/.test(roomCode)){setStatus("房間代碼必須是 4–8 位英數字。");return}
  socket?.close();room.textContent="";setStatus("正在連線至遊戲伺服器…");
  try{socket=new WebSocket(API.replace(/^http/,"ws")+"/api/realtime")}catch{setStatus("無法建立連線，請檢查 API 網址。");return}
  socket.addEventListener("open",()=>socket?.send(JSON.stringify({type:"auth",token})));
  socket.addEventListener("message",e=>{let d;try{d=JSON.parse(e.data)}catch{return}
   if(d.type==="authenticated"){socket?.send(JSON.stringify({type:"join",mode:mode.value,code:roomCode}));return}
   if(d.type==="error"){setStatus(d.message||"伺服器回報錯誤。");return}
   if(d.type==="room"){setStatus("已加入 "+d.code+" · "+(d.mode==="boss"?"合作 Boss":"競技場")+" · "+d.players.length+"/4 人");room.textContent="玩家： "+d.players.map(p=>p.name+"（HP "+p.hp+"）").join("、")+"\nBoss HP："+d.bossHp+"\n敵人 HP："+(d.mobs||[]).map(m=>m.hp).join(" / ");return}
   if(d.type==="move"){room.textContent="玩家移動同步中；最近更新："+d.id.slice(0,8);return}
   if(d.type==="combat"){const players=(d.players||[]).map(p=>p.name+"（HP "+p.hp+"）").join("、");room.textContent="玩家："+players+"\nBoss HP："+d.bossHp+"\n敵人 HP："+(d.mobs||[]).map(m=>m.hp).join(" / ")}
  });
  socket.addEventListener("error",()=>setStatus("連線失敗：請確認 API 已部署並允許目前網站來源。"));
  socket.addEventListener("close",e=>{if(!destroyed)setStatus("連線已關閉（"+e.code+"）。")});
 }
 const move=()=>{if(!socket||socket.readyState!==WebSocket.OPEN||Date.now()-lastMove<80)return;const p=G.pl;if(!p)return;lastMove=Date.now();send({type:"move",x:Math.max(0,Math.min(1,p.x/Math.max(1,G.W))),y:Math.max(0,Math.min(1,p.y/Math.max(1,G.H)))});};
 const moveTimer=setInterval(()=>{if(!container.isConnected){destroyed=true;clearInterval(moveTimer);socket?.close(1000,"account page closed");return}move()},100);
 function refresh(){const c=roleColor();roleDot.style.color=c;roleDot.style.background=c;roleText.textContent="職業代表色粒子光環 · "+c;paint()}
 refresh();
 return {refresh,destroy(){destroyed=true;clearInterval(moveTimer);socket?.close(1000,"account page closed");container.replaceChildren()}};
}
