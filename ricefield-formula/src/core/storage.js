const Store=(()=>{const K='rfsd_v1';let d={money:300,unlocked:[],stages:{},slots:{},tut:0};
try{Object.assign(d,JSON.parse(localStorage.getItem(K)||'{}'))}catch(e){}
d.save=()=>{try{localStorage.setItem(K,JSON.stringify({money:d.money,unlocked:d.unlocked,stages:d.stages,slots:d.slots,tut:d.tut}))}catch(e){}};
d.has=id=>!PARTS[id].unlock||d.unlocked.includes(id);return d})();
