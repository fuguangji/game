// 互動教程：依玩家實際操作逐步推進（建造 → 試飛），可隨時略過；完成狀態存於 Store.tut
const Tut=(()=>{
 const T=navigator.maxTouchPoints>0&&'ontouchstart' in window;
 const has=id=>[...B.cells.values()].some(p=>p.id==id);
 const steps=[
  {s:'workshop',t:'歡迎來到工作台！中央圓形是「核心(駕駛艙)」，機頭朝右 →。每個零件佔一格，所有零件都必須與核心相連。',nx:1},
  {s:'workshop',t:()=>T?'先選左側「骨架」，點一下核心旁邊的空格放置。（長按可拆除）':'先選左側「骨架」，左鍵點核心旁邊的空格放置。（右鍵拆除，可按住拖曳連續放置）',ck:()=>has('frame')},
  {s:'workshop',t:'接著選「大型木翼」，放在機身旁。機翼產生升力，沒有機翼就飛不起來。小技巧：機翼放在重心稍後方較穩。',ck:()=>has('wing')},
  {s:'workshop',t:'再放一個「推進器」。它提供推力，但會發熱；按 R 旋轉、F 鏡像可改變推力方向。',ck:()=>has('thruster')},
  {s:'workshop',t:'零件如果沒有接到核心，會被畫上「紅框」並無法試飛。試著在遠處放一個骨架看看，再把它接上或拆除。',nx:1},
  {s:'workshop',t:'藍點＝重心(CG)，黃點＝升力中心(CP)。黃點應在藍點稍後方(左側)；若左側面板出現「頭重／尾重」警告，就調整機翼位置。',nx:1},
  {s:'workshop',t:'左側面板顯示質量、造價與預算%（不可超支）、推重比 TWR（>1 才能垂直爬升，約 0.4 以上可平地起飛）。滾輪縮放、Space+左鍵平移，Ctrl+Z 復原。',nx:1},
  {s:'workshop',t:()=>'準備好了就按「▶ 試飛」'+(T?'':'（或按 Space）')+'。失敗不會損失任何資金，放心嘗試！',ck:()=>state=='flight'},
  {s:'flight',t:()=>T?'按住右側「推進」加速。':'按住 D（或 →）推進加速。A 為煞車。',ck:()=>F&&F.T>0},
  {s:'flight',t:()=>T?'速度夠快後，按住左側 ▲ 拉起機頭離地。':'速度夠快後，按 W（或 ↑）拉起機頭離地；S 壓低機頭。',ck:()=>F&&F.agl>1.5},
  {s:'flight',t:'貼近地面（約 3 公尺內）會觸發「地面效應」：升力 +30%、誘導阻力 −40%，是本作招牌技巧，但要小心地形！',ck:()=>F&&F.ge>0.3,nx:1},
  {s:'flight',t:()=>'注意左上角溫度條：過熱會熄火。'+(T?'點「散熱」鈕':'按 Space/Q')+'可緊急散熱(冷卻 8 秒)。機頭太高會「失速」；落地請保持機身水平、垂直速度要小。飛越終點線即過關。Esc 可返回工作台。',nx:1,end:1}
 ];
 let i=-1,el=null,skipped=0;
 function mk(){if(el)return;el=document.createElement('div');el.id='tut';
  el.style.cssText='position:fixed;left:50%;top:44px;transform:translateX(-50%);max-width:min(560px,92vw);background:#1d2b1af2;border:2px solid #f2c75c;border-radius:10px;padding:10px 14px;z-index:9;font-size:14px;line-height:1.55;color:#f6ecd0;display:none;pointer-events:auto';
  el.addEventListener('pointerdown',e=>e.stopPropagation());document.body.appendChild(el)}
 function show(){mk();const s=steps[i];if(!s||state!=s.s){el.style.display='none';return}
  const txt=typeof s.t=='function'?s.t():s.t;
  el.innerHTML=`<div style="font-size:12px;opacity:.7">教學 ${i+1}/${steps.length}</div><div>${txt}</div><div style="margin-top:6px;text-align:right">${s.nx?`<button id="tn">${s.end?'完成教學':'下一步 ▶'}</button>`:''}<button id="ts" style="background:#999">略過教學</button></div>`;
  el.style.display='block';const n=document.getElementById('tn');if(n)n.onclick=next;document.getElementById('ts').onclick=()=>stop(1)}
 function next(){i++;if(i>=steps.length)return stop(1);show()}
 function start(){i=0;mk();show()}
 function stop(done){i=-1;if(el)el.style.display='none';if(done&&!Store.tut){Store.tut=1;Store.save()}}
 function tick(){if(i<0)return;if(state=='menu'||state=='result'){if(state=='result'&&i>=8)stop(1);else el&&(el.style.display='none');if(state=='menu')i=-1;return}
  const s=steps[i];if(s.ck&&s.ck()){i++;if(i>=steps.length)return stop(1)}
  if(!el||el.dataset.i!=i+state+(typeof steps[i].t=='function'?performance.now()>>10:'')){mk();el.dataset.i=i+state+(typeof steps[i].t=='function'?performance.now()>>10:'');show()}}
 return{start,stop,tick,get active(){return i>=0}}
})();
