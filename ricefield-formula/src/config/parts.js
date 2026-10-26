// 零件資料庫。m=質量kg cost=造價 thrust=推力N lift=升力面積m² cl=最大升力係數 cd=阻力面積 heat=發熱/秒 cool=散熱/秒 unlock=商店解鎖價
const PARTS={
 core:{n:'核心(駕駛艙)',c:'#e8b84a',m:20,cost:0},
 frame:{n:'骨架',c:'#8a6a4a',m:5,cost:10},
 wing:{n:'大型木翼',c:'#d9b36c',m:4,cost:20,lift:3,cl:1.5,cd:.1,wood:1},
 swept:{n:'高速後掠翼',c:'#9ec5d8',m:5,cost:45,lift:2,cl:.9,cd:.03,unlock:150},
 thruster:{n:'推進器',c:'#e06a4a',m:12,cost:60,thrust:400,heat:14},
 big:{n:'高功率推進器',c:'#ff4a2a',m:20,cost:140,thrust:900,heat:30,unlock:200},
 cooler:{n:'散熱鰭片',c:'#7fd0b0',m:2,cost:15,cool:10,unlock:80},
 rubber:{n:'橡皮筋彈射',c:'#c0507a',m:2,cost:10,rubber:1}
};
