// 狀態機 + 工作台 + 飛行 + 畫面 (menu/stages/shop/workshop/flight/result)
const cv=document.getElementById('c'),ctx=cv.getContext('2d'),ui=document.getElementById('ui');
let W,H;const rs=()=>{W=cv.width=innerWidth;H=cv.height=innerHeight};addEventListener('resize',rs);rs();
let state='menu',stage=null,B=new Builder(),tool={id:'frame',r:0,f:0},cam={x:0,y:0,z:36},mouse={x:-99,y:-99},F=null,keys={},tinp={thrust:0,brake:0,up:0,down:0},spaceDown=false,spaceUsed=false;
const touch='ontouchstart' in window;
function flash(t){let m=document.getElementById('msg');if(!m)return;m.textContent=t;m.style.display='block';clearTimeout(flash.t);flash.t=setTimeout(()=>m.style.display='none',2200)}
function stars(id){return(Store.stages[id]||{}).stars||0}
// ---------- 畫面 ----------
function menu(){state='menu';Tut.stop();ui.innerHTML=`<div class="scr"><h1>稻香方程式<br>空天黎明</h1><p>Ricefield Formula: Skyward Dawn</p><button onclick="stagesScr()">關卡選擇</button><button onclick="shop()">研發商店</button><button onclick="enter(0);Tut.start()">教學</button><p>資金：$${Store.money}</p></div>`}
function stagesScr(){state='menu';ui.innerHTML=`<div class="scr"><h2>關卡選擇</h2>`+STAGES.map((s,i)=>{const ok=i==0||stars(STAGES[i-1].id)>0;return`<button ${ok?'':'disabled'} onclick="enter(${i})">${s.id} ${s.name} ${'★'.repeat(stars(s.id))}${'☆'.repeat(3-stars(s.id))}</button>`}).join('')+`<button onclick="menu()">返回</button></div>`}
function shop(msg){state='menu';ui.innerHTML=`<div class="scr"><h2>研發商店　資金 $${Store.money}</h2>${msg||''}`+Object.keys(PARTS).filter(k=>PARTS[k].unlock).map(k=>`<button ${Store.has(k)||Store.money<PARTS[k].unlock?'disabled':''} onclick="buy('${k}')">${PARTS[k].n} — ${Store.has(k)?'已解鎖':'$'+PARTS[k].unlock}</button>`).join('')+`<button onclick="menu()">返回</button></div>`}
function buy(k){if(Store.money>=PARTS[k].unlock&&!Store.has(k)){Store.money-=PARTS[k].unlock;Store.unlocked.push(k);Store.save()}shop()}
function enter(i){Tut.stop();stage=STAGES[i];workshop();if(i==0&&!Store.tut)Tut.start()}
function workshop(){state='workshop';tool.id=stage.allow.filter(k=>Store.has(k)&&k!='core')[0]||'frame';
 ui.innerHTML=`<div id="panel"><b>${stage.id} ${stage.name}</b><div style="font-size:12px">${stage.desc}</div><hr>`+
 stage.allow.filter(k=>Store.has(k)&&k!='core').map(k=>`<button id="b_${k}" onclick="tool.id='${k}';sel()">${PARTS[k].n} $${PARTS[k].cost}</button>`).join('')+
 `<hr><button onclick="fly()">▶ 試飛 (Space)</button><button onclick="B.undo()">↶ 復原</button><button onclick="B.redo()">↷ 重做</button>
 <button onclick="tool.r=(tool.r+1)&3">⟳ 旋轉 R</button><button onclick="tool.f^=1">⇋ 鏡像 F</button>
 <button onclick="saveBP()">💾 存檔槽</button><button onclick="loadBP()">📂 讀檔槽</button><button onclick="expBP()">⬆ 匯出JSON</button><button onclick="impBP()">⬇ 匯入JSON</button>
 <button onclick="B.push();B.reset()">🗑 清空</button><button onclick="Tut.start()">❓ 教學</button><button onclick="stagesScr()">返回</button><div id="st"></div></div><div id="msg"></div>`;sel()}
function sel(){document.querySelectorAll('#panel [id^=b_]').forEach(b=>b.classList.toggle('sel',b.id=='b_'+tool.id))}
function saveBP(){const n=prompt('存入槽位 (1-9)','1');if(n){Store.slots[n]=B.toJSON();Store.save();flash('已存入槽位 '+n)}}
function loadBP(){const n=prompt('讀取槽位 (1-9)','1');if(n&&Store.slots[n]){B.fromJSON(Store.slots[n])}else if(n)flash('槽位為空')}
function expBP(){prompt('複製此 JSON 藍圖代碼：',B.toJSON())}
function impBP(){const t=prompt('貼上 JSON 藍圖代碼：');if(t)try{B.fromJSON(t)}catch(e){flash('匯入失敗：'+e)}}
function fly(){const S=B.stats();
 if(S.bad.size)return flash('有未連接核心的零件(紅色)');
 for(const p of B.cells.values())if(!stage.allow.includes(p.id)||!Store.has(p.id))return flash('含本關不可用零件：'+PARTS[p.id].n);
 if(S.cost>stage.budget)return flash('超出預算！');if(!S.lift)return flash('至少需要一個機翼');
 F=new Flight(B,stage);state='flight';tinp={thrust:0,brake:0,up:0,down:0,skill:0};Snd.init();PT.length=0;
 ui.innerHTML=touch?`<button class="tb" style="left:14px;bottom:100px" id="tu">▲</button><button class="tb" style="left:14px" id="td">▼</button><button class="tb" style="right:14px;bottom:100px" id="tt">推進</button><button class="tb" style="right:100px" id="tbk">煞車</button><button class="tb" style="right:100px;bottom:100px" id="tsk">散熱</button><button style="position:absolute;top:8px;right:8px" onclick="back()">✕</button>`:`<div style="position:absolute;bottom:8px;left:8px;font-size:12px">W/S 俯仰　D 推進　A 煞車　Space/Q 緊急散熱(冷卻8s)　Esc 返回</div>`;
 if(touch)[['tu','up'],['td','down'],['tt','thrust'],['tbk','brake'],['tsk','skill']].forEach(([i,k])=>{const e=document.getElementById(i);e.onpointerdown=()=>tinp[k]=1;e.onpointerup=e.onpointerleave=()=>tinp[k]=0})}
function back(){workshop()}
function finish(r){state='result';let h;
 if(!r.ok)h=`<h2>${r.why}</h2><p>失敗不會有任何損失</p>`;
 else{const S=F.S,rem=stage.budget-S.cost,pv=Store.stages[stage.id]||{stars:0,save:0},st=1+(F.t<=stage.t2||!F.dmg?1:0)+(rem>=stage.budget*.4?1:0),first=!pv.stars,save=Math.floor(rem*.5),bonus=Math.max(0,save-(pv.save||0)),rw=first?stage.reward:0;
  Store.money+=rw+bonus;Store.stages[stage.id]={stars:Math.max(pv.stars,st),save:Math.max(pv.save||0,save)};Store.save();
  h=`<h2>任務完成 ${'★'.repeat(st)}${'☆'.repeat(3-st)}</h2><p>用時 ${F.t.toFixed(1)}s (★★目標：≤${stage.t2}s 或全程無結構損毀)　${F.dmg?'發生過硬著陸損毀':'結構完好'}<br>剩餘預算 ${rem}/${stage.budget} (★★★目標 ≥40%)<br>首通獎勵 $${rw}　省錢獎金 $${bonus}<br>資金 $${Store.money}${F.respawns?'<br>檢查點重生 '+F.respawns+' 次':''}</p>`}
 ui.innerHTML=`<div class="scr">${h}<button onclick="workshop()">回工作台</button><button onclick="stagesScr()">關卡選擇</button></div>`}
// ---------- 輸入 ----------
addEventListener('keydown',e=>{const k=e.key.toLowerCase();keys[k]=1;
 if(state=='workshop'){if(k=='r')tool.r=(tool.r+1)&3;else if(k=='f')tool.f^=1;else if(e.ctrlKey&&k=='z'){B.undo();e.preventDefault()}else if(e.ctrlKey&&k=='y'){B.redo();e.preventDefault()}else if(k==' '){spaceDown=1;e.preventDefault()}}
 else if(state=='flight'&&k=='escape')back();if(k==' '&&state=='flight')e.preventDefault()});
addEventListener('keyup',e=>{const k=e.key.toLowerCase();keys[k]=0;if(k==' '&&spaceDown){spaceDown=0;if(!spaceUsed&&state=='workshop')fly();spaceUsed=0}});
const cell=(x,y)=>[Math.round((x-W/2)/cam.z+cam.x),Math.round((y-H/2)/cam.z+cam.y)];
const ptrs=new Map();let pinch=0,lastCell='',mode='';
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('wheel',e=>{if(state=='workshop')cam.z=clamp(cam.z*Math.exp(-e.deltaY*.001),8,120)});
cv.addEventListener('pointerdown',e=>{if(state!='workshop')return;cv.setPointerCapture(e.pointerId);const p={x:e.clientX,y:e.clientY,sx:e.clientX,sy:e.clientY,moved:0,long:0,touch:e.pointerType=='touch'};ptrs.set(e.pointerId,p);
 if(ptrs.size==2){pinch=0;mode='pinch';return}
 const[cx,cy]=cell(e.clientX,e.clientY);lastCell=cx+','+cy;
 if(p.touch){p.tm=setTimeout(()=>{if(!p.moved){B.remove(cx,cy);p.long=1}},500);mode='tap'}
 else if(e.button==1||(e.button==0&&spaceDown)){mode='pan';spaceUsed=1}
 else if(e.button==2){mode='del';B.remove(cx,cy)}else{mode='put';B.place(cx,cy,tool.id,tool.r,tool.f)}});
cv.addEventListener('pointermove',e=>{mouse.x=e.clientX;mouse.y=e.clientY;const p=ptrs.get(e.pointerId);if(!p||state!='workshop')return;
 const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
 if(ptrs.size==2){const[a,b]=[...ptrs.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinch)cam.z=clamp(cam.z*d/pinch,8,120);pinch=d;cam.x-=dx/2/cam.z;cam.y-=dy/2/cam.z;p.moved=1;return}
 if(p.touch&&Math.hypot(e.clientX-p.sx,e.clientY-p.sy)>10){p.moved=1;clearTimeout(p.tm)}
 if(mode=='pan'){cam.x-=dx/cam.z;cam.y-=dy/cam.z}
 else if(mode=='put'||mode=='del'){const[cx,cy]=cell(e.clientX,e.clientY),k=cx+','+cy;if(k!=lastCell){lastCell=k;mode=='put'?B.place(cx,cy,tool.id,tool.r,tool.f):B.remove(cx,cy)}}});
const pend=e=>{const p=ptrs.get(e.pointerId);if(!p)return;clearTimeout(p.tm);if(p.touch&&mode=='tap'&&!p.moved&&!p.long&&ptrs.size==1){const[cx,cy]=cell(e.clientX,e.clientY);B.place(cx,cy,tool.id,tool.r,tool.f)}ptrs.delete(e.pointerId);if(!ptrs.size)mode=''};
cv.addEventListener('pointerup',pend);cv.addEventListener('pointercancel',pend);
// ---------- 繪製 ----------
function drawPart(c,id,r,f,s,sx,sy){c.save();c.translate(sx,sy);c.rotate(r*Math.PI/2);c.scale(f?-s:s,s);c.fillStyle=PARTS[id].c;c.strokeStyle='#3a2a1a';c.lineWidth=.06;c.beginPath();
 if(id=='core')c.arc(0,0,.46,0,7);else if(id=='wing'){c.moveTo(-.5,.1);c.lineTo(.5,-.1);c.lineTo(.5,.15);c.lineTo(-.5,.35)}
 else if(id=='swept'){c.moveTo(-.5,.4);c.lineTo(.5,-.3);c.lineTo(.5,.1)}else if(id=='thruster'||id=='big'){c.rect(-.4,-.3,.8,.6)}
 else if(id=='cooler'){c.rect(-.4,-.4,.8,.8)}else if(id=='rubber')c.ellipse(0,0,.45,.2,0,0,7);else c.rect(-.45,-.45,.9,.9);
 c.fill();c.stroke();
 if(id=='core'){c.fillStyle='#9fd8ff';c.beginPath();c.arc(.15,-.1,.18,0,7);c.fill()}
 if(id=='thruster'||id=='big'){c.fillStyle='#333';c.beginPath();c.moveTo(-.4,-.2);c.lineTo(-.55,-.3);c.lineTo(-.55,.3);c.lineTo(-.4,.2);c.fill()}
 if(id=='cooler'){c.beginPath();for(let i=-2;i<3;i++){c.moveTo(-.4,i*.15);c.lineTo(.4,i*.15)}c.stroke()}
 if(id=='frame'){c.beginPath();c.moveTo(-.45,-.45);c.lineTo(.45,.45);c.moveTo(.45,-.45);c.lineTo(-.45,.45);c.stroke()}
 c.restore()}
function drawWorkshop(){ctx.fillStyle='#223426';ctx.fillRect(0,0,W,H);const z=cam.z,ox=W/2-cam.x*z,oy=H/2-cam.y*z;
 ctx.strokeStyle='#ffffff18';ctx.lineWidth=1;ctx.beginPath();const x0=Math.floor((-ox)/z)-1,x1=Math.ceil((W-ox)/z)+1,y0=Math.floor((-oy)/z)-1,y1=Math.ceil((H-oy)/z)+1;
 for(let x=x0;x<=x1;x++){ctx.moveTo(ox+(x-.5)*z,0);ctx.lineTo(ox+(x-.5)*z,H)}for(let y=y0;y<=y1;y++){ctx.moveTo(0,oy+(y-.5)*z);ctx.lineTo(W,oy+(y-.5)*z)}ctx.stroke();
 ctx.fillStyle='#ffffff30';ctx.font=z*.4+'px sans-serif';ctx.fillText('→ 機頭方向',ox+z,oy-z*.7);
 const S=B.stats();for(const[k,p]of B.cells){const[x,y]=k.split(',').map(Number),sx=ox+x*z,sy=oy+y*z;drawPart(ctx,p.id,p.r,p.f,z,sx,sy);if(S.bad.has(k)){ctx.strokeStyle='#f33';ctx.lineWidth=3;ctx.strokeRect(sx-z/2,sy-z/2,z,z)}}
 const dot=(x,y,c)=>{ctx.fillStyle=c;ctx.beginPath();ctx.arc(ox+x*z,oy+y*z,z*.15,0,7);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke()};
 dot(S.cgx,S.cgy,'#4aa3ff');if(S.lift)dot(S.cpx,S.cgy,'#ffe14a');
 if(!touch){const[cx,cy]=cell(mouse.x,mouse.y);ctx.globalAlpha=.5;drawPart(ctx,tool.id,tool.r,tool.f,z,ox+cx*z,oy+cy*z);ctx.globalAlpha=1}
 const el=document.getElementById('st');if(el)el.textContent=`質量 ${S.mass.toFixed(0)}kg\n造價 $${S.cost} / ${stage.budget} (${(S.cost/stage.budget*100).toFixed(0)}%)\n推力 ${S.thrust}N  TWR ${S.twr.toFixed(2)}\n升力係數 ${(S.lift*S.cl).toFixed(1)} (面積${S.lift})\n● 藍=重心 ● 黃=升力中心\n`+(S.bad.size?'⚠ 有未連接零件\n':'')+(S.warn?'⚠ '+S.warn:'')}
function drawFlight(){const f=F,st=f.st,z=22,cx=f.x,cy=f.y,sxo=x=>W*.35+(x-cx)*z,syo=y=>H*.6-(y-cy)*z;
 const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#78b8e8');g.addColorStop(1,'#f6e7b0');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
 if(st.radar){ctx.fillStyle='#ff333322';const a=sxo(st.radar.x0),b=sxo(st.radar.x1);ctx.fillRect(a,0,b-a,H);ctx.strokeStyle='#f33';ctx.beginPath();for(let x=Math.max(a,0);x<Math.min(b,W);x+=0)break;ctx.stroke()}
 ctx.beginPath();ctx.moveTo(0,H);for(let px=0;px<=W;px+=4){const wx=cx+(px-W*.35)/z;ctx.lineTo(px,syo(tY(st,wx)+.1*Math.sin(f.t*2+wx*.8)))}ctx.lineTo(W,H);ctx.fillStyle='#d8a928';ctx.fill();
 ctx.strokeStyle='#f3d35c';ctx.lineWidth=3;ctx.stroke();
 if(st.radar){const hy=(wx)=>syo(tY(st,wx)+st.radar.h);ctx.strokeStyle='#f55';ctx.setLineDash([6,6]);ctx.beginPath();let first=1;for(let px=0;px<=W;px+=8){const wx=cx+(px-W*.35)/z;if(wx<st.radar.x0||wx>st.radar.x1){first=1;continue}first?ctx.moveTo(px,hy(wx)):ctx.lineTo(px,hy(wx));first=0}ctx.stroke();ctx.setLineDash([])}
 for(const p of[...(st.cps||[]),st.len]){const sx=sxo(p);ctx.fillStyle=p==st.len?'#fff':'#ff0';ctx.fillRect(sx,syo(tY(st,p)+8),3,8*z);ctx.fillRect(sx,syo(tY(st,p)+8),22,14)}
 for(const q of PT){ctx.globalAlpha=Math.max(0,q.l);ctx.fillStyle=q.c;ctx.fillRect(sxo(q.x),syo(q.y),3,3)}ctx.globalAlpha=1;
 for(const p of f.parts){const[px,py]=f.pp(p);ctx.save();ctx.translate(sxo(px),syo(py));ctx.rotate(-f.th);
  if(f.T>0&&PARTS[p.id].thrust){ctx.save();ctx.translate(-p.dx*.55*z,p.dy*.55*z);ctx.rotate(Math.atan2(p.dy,-p.dx));ctx.fillStyle='#ffb02a';ctx.beginPath();ctx.moveTo(0,-.2*z);ctx.lineTo((.65+Math.random()*.8)*z,0);ctx.lineTo(0,.2*z);ctx.fill();ctx.restore()}
  drawPart(ctx,p.id,p.r,p.f,z,0,0);ctx.restore()}
 ctx.fillStyle='#000a';ctx.fillRect(8,8,230,118);ctx.fillStyle='#fff';ctx.font='14px sans-serif';
 const L=[`空速 ${(f.V*3.6).toFixed(0)} km/h`,`離地 ${Math.max(0,f.agl).toFixed(1)} m`,`進度 ${f.x.toFixed(0)} / ${st.len} m`,`時間 ${f.t.toFixed(1)} s`,`姿態 ${(f.th*57.3).toFixed(0)}°`];L.forEach((t,i)=>ctx.fillText(t,16,28+i*18));
 ctx.fillStyle='#444';ctx.fillRect(16,114,206,6);ctx.fillStyle=f.over?'#f33':'#fa3';ctx.fillRect(16,114,206*Math.min(1,f.heat/100),6);
 if(f.ge>0){ctx.fillStyle='#8f8';ctx.fillText('★ 地面效應 '+(f.ge*100|0)+'%',W/2-60,30)}
 if(f.stalled){ctx.fillStyle='#f66';ctx.fillText('⚠ 失速',W/2-20,50)}if(f.dmgT>0){ctx.fillStyle='#fa4';ctx.fillText('⚠ 結構受損(硬著陸)',W/2-60,110)}if(f.respawned>0){ctx.fillStyle='#ff0';ctx.fillText('↺ 從檢查點重新出發',W/2-60,90)}
 if(f.vent>0){ctx.fillStyle='#8cf';ctx.fillText('散熱冷卻 '+f.vent.toFixed(0)+'s',16,146)}if(f.over){ctx.fillStyle='#f66';ctx.fillText('🔥 過熱熄火',W/2-30,70)}}
// ---------- 音效與粒子 ----------
const PT=[];
const Snd={ac:null,init(){if(this.ac)return;try{const a=this.ac=new(window.AudioContext||window.webkitAudioContext)();this.o=a.createOscillator();this.o.type='sawtooth';this.g=a.createGain();this.g.gain.value=0;this.o.connect(this.g).connect(a.destination);this.o.start();
 const b=a.createBuffer(1,a.sampleRate,a.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;this.n=a.createBufferSource();this.n.buffer=b;this.n.loop=true;this.wg=a.createGain();this.wg.gain.value=0;const f=a.createBiquadFilter();f.type='lowpass';f.frequency.value=900;this.n.connect(f).connect(this.wg).connect(a.destination);this.n.start()}catch(e){}},
 upd(f){if(!this.ac)return;const t=this.ac.currentTime;this.o.frequency.setTargetAtTime(50+f.V*1.2+(f.T>0?40:0),t,.1);this.g.gain.setTargetAtTime(f.T>0?.05:0,t,.1);this.wg.gain.setTargetAtTime(Math.min(.12,f.V/300),t,.1)},
 beep(fr,d=.15){if(!this.ac)return;const a=this.ac,o=a.createOscillator(),g=a.createGain();o.frequency.value=fr;g.gain.value=.08;o.connect(g).connect(a.destination);o.start();g.gain.setTargetAtTime(0,a.currentTime+d*.5,d*.3);o.stop(a.currentTime+d)},
 stop(){if(this.ac){this.g.gain.value=0;this.wg.gain.value=0}}};
function spawnPT(f,dt){const r=()=>Math.random()-.5;
 if(f.T>0)for(const p of f.parts)if(PARTS[p.id].thrust&&Math.random()<.6){const[x,y]=f.pp(p);PT.push({x:x,y:y,vx:f.vx+(-p.dx*Math.cos(f.th)+p.dy*Math.sin(f.th))*6+r()*2,vy:f.vy+(-p.dx*Math.sin(f.th)-p.dy*Math.cos(f.th))*6+r()*2,l:.6,c:'#999'})}
 if(f.agl<4&&f.V>8)for(let i=0;i<2;i++)PT.push({x:f.x+r()*4-2,y:tY(f.st,f.x)+.2,vx:f.vx*.2-3,vy:2+Math.random()*3*f.ge,l:.9,c:'#f3d35c'});
 for(const q of PT){q.x+=q.vx*dt;q.y+=q.vy*dt;q.vy-=3*dt;q.l-=dt}for(let i=PT.length-1;i>=0;i--)if(PT[i].l<=0)PT.splice(i,1);if(PT.length>400)PT.splice(0,100)}
// ---------- 迴圈 ----------
let last=performance.now(),acc=0;
function loop(n){requestAnimationFrame(loop);Tut.tick();const dt=Math.min(.1,(n-last)/1000);last=n;
 if(state=='workshop')drawWorkshop();
 else if(state=='flight'){acc+=dt;const inp={pitch:(keys.w||keys.arrowup||tinp.up?1:0)-(keys.s||keys.arrowdown||tinp.down?1:0),thrust:keys.d||keys.arrowright||tinp.thrust,brake:keys.a||keys.arrowleft||tinp.brake,skill:keys[' ']||keys.q||tinp.skill};
  while(acc>=1/120){const rs=F.respawns,vt=F.vented>0;F.step(1/120,inp);if(F.respawns>rs||(!vt&&F.vented>0))Snd.beep(F.respawns>rs?200:660,.3);acc-=1/120}spawnPT(F,dt);Snd.upd(F);drawFlight();if(F.done){Snd.stop();Snd.beep(F.done.ok?880:120,.4);finish(F.done)}}
 else if(state=='result'&&F)drawFlight();
 else if(state!='workshop'){ctx.fillStyle='#2c4a3a';ctx.fillRect(0,0,W,H)}}
menu();requestAnimationFrame(loop);
