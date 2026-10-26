const ALL=['core','frame','wing','swept','thruster','big','cooler'];
const STAGES=[
 {id:'1-1',name:'稻田試飛',desc:'飛越稻田，安全抵達終點。(白婉逸：先讓它飛起來吧)',budget:900,len:400,amp:3,freq:.03,t2:45,reward:300,wind:0,allow:ALL},
 {id:'1-2',name:'橡皮筋挑戰',desc:'只能用橡皮筋彈射。減重、滑翔！',budget:500,len:250,amp:2,freq:.03,t2:40,reward:400,wind:0,allow:['core','frame','wing','swept','rubber']},
 {id:'1-3',name:'山谷逆風',desc:'穿越起伏峽谷與陣風。(葉巖焓：硬闖就對了)',budget:1000,len:500,amp:12,freq:.04,t2:60,reward:500,wind:1,allow:ALL},
 {id:'1-4',name:'雷達死角',desc:'x=100~350 區間須低於 7m 掠地飛行，善用地面效應。(林星漓)',budget:900,len:450,amp:4,freq:.03,t2:60,reward:600,wind:0,radar:{x0:100,x1:350,h:7},allow:ALL},
 {id:'1-5',name:'長途巡航',desc:'多段地形長途飛行，注意散熱。(楊晨熙)',budget:1200,len:900,amp:8,freq:.025,t2:110,reward:800,wind:.5,cps:[300,600],allow:ALL}
];
