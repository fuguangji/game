// 2D 飛行物理：升力/阻力/失速/地面效應/地形碰撞
function tY(st,x){if(x<30)return 0;const r=Math.min(1,(x-30)/60);return r*st.amp*(Math.sin(x*st.freq)+.5*Math.sin(x*st.freq*2.3+1))}
const nrm=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
class Flight{
 constructor(b,st){this.st=st;const S=this.S=b.stats();this.parts=[];this.tl=[];let th=0,tn=0;
  for(const[k,p]of b.cells){const[x,y]=k.split(',').map(Number),lx=x-S.cgx,ly=-(y-S.cgy);this.parts.push({id:p.id,r:p.r,f:p.f,lx,ly});if(PARTS[p.id].thrust){th+=ly;tn++;let dx=p.f?-1:1,dy=0;for(let i=0;i<p.r;i++){[dx,dy]=[-dy,dx]}this.tl.push({lx,ly,dx,dy:-dy,t:PARTS[p.id].thrust});p.dx=dx;p.dy=-dy}}
  this.thrY=tn?th/tn:0;this.M=S.mass;this.I=S.mass*6;this.cpRel=S.cpx-S.cgx;this.h0=Math.max(...this.parts.map(p=>-p.ly))+.5;
  this.x=0;this.y=tY(st,0)+this.h0;this.vx=this.vy=this.th=this.w=0;this.heat=0;this.over=false;this.t=0;this.done=null;this.ge=0;this.stalled=false;this.T=0;this.rub=1.5;this.V=0;this.agl=0;this.dmg=0;this.tol=Math.min(8,4+.15*this.parts.filter(p=>p.id=='frame').length);this.cp=0;this.vent=0;this.respawns=0;this.vented=0}
 fail(why){const cps=this.st.cps||[],c=cps.filter(v=>this.x>=v).pop();if(c){this.cp=c;this.respawns++;this.x=c;this.y=tY(this.st,c)+this.h0+2;this.vx=14;this.vy=0;this.th=this.w=0;this.heat=0;this.over=false;this.rub=0;this.respawned=1.5}else this.done={ok:false,why}}
 pp(p){const c=Math.cos(this.th),s=Math.sin(this.th);return[this.x+p.lx*c-p.ly*s,this.y+p.lx*s+p.ly*c]}
 step(dt,inp){if(this.done)return;const st=this.st,S=this.S;this.t+=dt;
  const wd=st.wind,wx=-wd*3,wy=wd*5*Math.sin(this.t*1.3+this.x*.05)*Math.sin(this.t*.4);
  const rx=this.vx-wx,ry=this.vy-wy,V=Math.max(.01,Math.hypot(rx,ry));this.V=V;
  const a=nrm(this.th-Math.atan2(ry,rx)),cm=S.cl;let CL=clamp(5.5*a,-cm,cm);const sa=cm/5.5+.05;this.stalled=false;
  if(Math.abs(a)>sa){this.stalled=true;CL*=Math.max(.25,1-(Math.abs(a)-sa)*3)}
  let h=1e9;for(const p of this.parts){const[px,py]=this.pp(p);h=Math.min(h,py-.5-tY(st,px))}this.agl=h;
  const ge=this.ge=h<3?clamp(1-Math.max(0,h)/3,0,1):0;
  const q=.6*V*V,Lf=q*S.lift*CL*(1+.3*ge);
  let da=S.cdo+S.cdw*(1+V/20)+.04*CL*CL*S.lift*(1-.4*ge);
  if(this.stalled)da+=S.lift*.5*Math.min(1,(Math.abs(a)-sa)*3);if(inp.brake)da+=1.5;
  const D=q*da;let T=0;
  if(this.heat>=100)this.over=true;else if(this.heat<35)this.over=false;
  let Rb=0;if(inp.thrust&&!this.over){T=S.thrust;if(S.rubber&&this.rub>0){Rb=S.rubber*700;T+=Rb;this.rub-=dt}}
  let bx=Rb,by=0,tq=0;if(T>Rb)for(const e of this.tl){bx+=e.t*e.dx;by+=e.t*e.dy;tq+=e.lx*e.t*e.dy-e.ly*e.t*e.dx}
  if(inp.skill&&this.vent<=0&&this.heat>40){this.heat=30;this.vent=8;this.vented=.4;this.over=false}this.vent-=dt;this.vented-=dt;if(this.respawned)this.respawned-=dt;if(this.dmgT>0)this.dmgT-=dt;
  this.T=T;this.heat=Math.max(0,this.heat+((T>0?S.heat:0)-S.cool-3)*dt);
  const c=Math.cos(this.th),s=Math.sin(this.th);
  const Fx=bx*c-by*s-D*rx/V-Lf*ry/V,Fy=bx*s+by*c-D*ry/V+Lf*rx/V-this.M*9.8;
  this.vx+=Fx/this.M*dt;this.vy+=Fy/this.M*dt;
  const tau=Lf*this.cpRel+tq;
  this.w+=(tau/this.I+inp.pitch*4*Math.min(1,V/12)-a*.3*Math.min(V/10,2))*dt;this.w-=this.w*Math.min(3.5,.8+V*.04)*dt;
  this.th+=this.w*dt;this.x+=this.vx*dt;this.y+=this.vy*dt;
  let pen=-1e9;for(const p of this.parts){const[px,py]=this.pp(p);pen=Math.max(pen,tY(st,px)-(py-.5))}
  if(pen>0){const sl=(tY(st,this.x+.5)-tY(st,this.x-.5)),ng=Math.hypot(sl,1),nx=-sl/ng,ny=1/ng,vn=this.vx*nx+this.vy*ny,ta=Math.atan(sl);
   if(vn<-9||(Math.abs(nrm(this.th-ta))>.8&&this.V>3)){this.fail('墜毀！');return}
   if(vn<-this.tol&&!this.dmg){this.dmg=1;this.dmgT=2}this.y+=pen;if(vn<0){this.vx-=vn*nx;this.vy-=vn*ny}
   this.vx*=1-(inp.brake?1.2:.05)*dt;this.w=0;this.th+=(((inp.pitch>0&&V>8)?ta+.25:ta)-this.th)*Math.min(1,4*dt)}
  if(this.x>=st.len)this.done={ok:true};
  else if(st.radar&&this.x>st.radar.x0&&this.x<st.radar.x1&&h>st.radar.h)this.fail('被雷達發現！');
  else if(this.t>240)this.done={ok:false,why:'超時'};
  else if(this.t>10&&Math.hypot(this.vx,this.vy)<.3)this.done={ok:false,why:'停滯不動'};
 }
}
