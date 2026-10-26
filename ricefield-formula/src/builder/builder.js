// 稀疏格點 Map<"x,y",{id,r,f}> + 連通性(BFS) + Undo/Redo + 藍圖 JSON
class Builder{
 constructor(){this.reset()}
 reset(){this.cells=new Map([['0,0',{id:'core',r:0,f:0}]]);this.u=[];this.d=[]}
 snap(){return JSON.stringify([...this.cells])}
 push(){this.u.push(this.snap());if(this.u.length>200)this.u.shift();this.d=[]}
 load(s){this.cells=new Map(JSON.parse(s))}
 undo(){if(this.u.length){this.d.push(this.snap());this.load(this.u.pop())}}
 redo(){if(this.d.length){this.u.push(this.snap());this.load(this.d.pop())}}
 place(x,y,id,r,f){if(x==0&&y==0)return;const k=x+','+y,o=this.cells.get(k);if(o&&o.id==id&&o.r==r&&o.f==f)return;this.push();this.cells.set(k,{id,r,f})}
 remove(x,y){const k=x+','+y;if((x==0&&y==0)||!this.cells.has(k))return;this.push();this.cells.delete(k)}
 connected(){const s=new Set(['0,0']),q=[[0,0]];while(q.length){const[x,y]=q.pop();for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const k=(x+dx)+','+(y+dy);if(this.cells.has(k)&&!s.has(k)){s.add(k);q.push([x+dx,y+dy])}}}return s}
 stats(){const c=this.connected(),S={mass:0,cost:0,thrust:0,lift:0,cgx:0,cgy:0,cpx:0,cl:0,cdo:0,cdw:0,heat:0,cool:0,rubber:0,n:this.cells.size,bad:new Set()};let mx=0,my=0,lx=0;
 for(const[k,p]of this.cells){const d=PARTS[p.id],[x,y]=k.split(',').map(Number);if(!c.has(k))S.bad.add(k);
  S.mass+=d.m;S.cost+=d.cost;mx+=d.m*x;my+=d.m*y;S.thrust+=d.thrust||0;S.heat+=d.thrust?d.heat:0;S.cool+=d.cool||0;S.rubber+=d.rubber||0;
  if(d.lift){S.lift+=d.lift;lx+=d.lift*x;S.cl+=d.lift*d.cl}if(d.wood)S.cdw+=d.cd;else S.cdo+=d.cd??.05}
 S.cgx=mx/S.mass;S.cgy=my/S.mass;S.cpx=S.lift?lx/S.lift:S.cgx;S.cl=S.lift?S.cl/S.lift:1;
 const dx=S.cpx-S.cgx;S.warn=!S.lift?'無機翼，無法產生升力':dx<-3?'嚴重頭重(俯衝失控風險)':dx>.8?'嚴重尾重(失速仰翻風險)':'';
 S.twr=S.thrust/(S.mass*9.8);return S}
 toJSON(){return JSON.stringify({version:1,parts:[...this.cells].map(([k,p])=>{const[x,y]=k.split(',').map(Number);return{x,y,id:p.id,r:p.r,f:p.f}})})}
 fromJSON(t){const o=JSON.parse(t);if(!o||!Array.isArray(o.parts))throw'格式錯誤';const m=new Map([['0,0',{id:'core',r:0,f:0}]]);
  for(const p of o.parts){if(!PARTS[p.id]||!Number.isInteger(p.x)||!Number.isInteger(p.y))throw'零件無效';if(p.x||p.y)m.set(p.x+','+p.y,{id:p.id,r:(p.r|0)&3,f:p.f?1:0})}
  this.push();this.cells=m}
}
