// Harbor Command's shared, deterministic rules. No DOM, clock, or network access.
export const TICK_MS = 200;
export const COSTS = Object.freeze({
  worker: Object.freeze({ wood: 18, stone: 0 }),
  scout: Object.freeze({ wood: 23, stone: 8 }),
  yard: Object.freeze({ wood: 32, stone: 14 }),
  beacon: Object.freeze({ wood: 20, stone: 30 }),
});
export const RULES = Object.freeze({ width:20,height:14, maxTicks:900, target:750, unitCap:14, buildingCap:6, controlRadius:2, startWood:42, startStone:16 });
export const SEED = 410;
const SIDES = ['A','B'];
const STEPS = [[0,-1],[-1,0],[1,0],[0,1]];
const distance = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const location = (x,y) => ({x,y});
const at = (o,x,y) => o.x===x && o.y===y;
const tileAt = (s,x,y) => s.tiles[y]?.[x];
const neighbors = (x,y) => STEPS.map(([dx,dy]) => ({x:x+dx,y:y+dy}));
const inside = (s,x,y) => Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<s.width&&y<s.height;
const land = t => ['grass','sand','rock','dock'].includes(t);
const water = t => t==='water'||t==='dock';
const ready = (s,b) => b.readyTick <= s.tick;
const passable = (s,type,x,y) => inside(s,x,y) && (type==='scout' ? water(tileAt(s,x,y)) : land(tileAt(s,x,y)));
function report(s,side,text) {
  s.events.push({ tick:s.tick, side, text });
  if (s.events.length>24) s.events.shift();
}
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function terrain(seed) {
  const rng = random(seed);
  const tiles = Array.from({length:RULES.height},()=>Array(RULES.width).fill('water'));
  const shore = [null,null,[3,5],[2,6],[1,7],[1,7],[1,6],[1,6],[1,7],[1,7],[2,7],[3,6],[4,5],null];
  for (let y=2;y<=12;y++) {
    const [a,b]=shore[y];
    for (let x=a;x<=b;x++) {
      const edge=x===a||x===b||[shore[y-1],shore[y+1]].some(row=>!row||x<row[0]||x>row[1]);
      const t=edge?'sand':rng()<0.09?'rock':'grass';
      tiles[y][x]=t;
      tiles[y][RULES.width-1-x]=t;
    }
  }
  // Built-in coast access and the irregular rocks off the northern pass.
  tiles[9][7]=tiles[9][12]='dock';
  tiles[2][9]=tiles[2][10]='sand';
  tiles[3][9]='rock';
  tiles[11][9]='sand'; tiles[12][10]='sand';
  [[3,9,'grass'],[4,9,'grass'],[4,4,'grass'],[5,5,'grass'],[3,7,'grass'],[5,8,'grass'],[5,10,'grass'],[4,6,'rock']].forEach(([x,y,t])=>{ tiles[y][x]=tiles[y][19-x]=t; });
  return tiles;
}
function addUnit(s,side,type,x,y) {
  s.units.push({ id:'u'+s.serial++, side, type, x, y, order:null });
}
function addBuilding(s,side,type,x,y,readyTick=0) {
  s.buildings.push({ id:'b'+s.serial++, side, type, x, y, readyTick, queue:[] });
}
export function createGame({seed=SEED,mode='solo',difficulty='easy'}={}) {
  const usedSeed=Number.isInteger(seed) ? seed>>>0 : SEED;
  const s={seed:usedSeed,mode:['duo','practice'].includes(mode)?mode:'solo',difficulty:difficulty==='hard'?'hard':'easy',
    width:RULES.width,height:RULES.height,tiles:terrain(usedSeed),tick:0,serial:1,
    players:Object.fromEntries(SIDES.map(side=>[side,{wood:RULES.startWood,stone:RULES.startStone,score:0}])),
    units:[],buildings:[],deposits:[],controls:[{id:'signal',x:9,y:6,side:null,contested:false}],winner:null,overReason:null,events:[]};
  const rng=random(usedSeed+19);
  const amounts=[100,85,100,70].map(base=>base+Math.floor(rng()*11));
  for (const [i,side] of SIDES.entries()) {
    const x = a => i ? s.width-1-a : a;
    addBuilding(s,side,'hall',x(3),9);
    addUnit(s,side,'worker',x(4),9); addUnit(s,side,'worker',x(3),10);
    addUnit(s,side,'scout',x(8),9);
    for (const [j,[xx,y,type]] of [[5,8,'wood'],[5,10,'stone'],[4,4,'wood'],[4,6,'stone']].entries()) {
      s.deposits.push({id:'d'+side+j,type,x:x(xx),y,remaining:amounts[j]});
    }
  }
  return s;
}
export function snapshot(state) {
  return JSON.parse(JSON.stringify(state));
}
const bad = (code,reason) => ({ok:false,code,reason});
const ok = () => ({ok:true});
const affordable = (p,c) => p.wood>=c.wood && p.stone>=c.stone;
function charge(p,c) { p.wood-=c.wood; p.stone-=c.stone; }
function route(s,u,goals) {
  if (!goals.length) return null;
  const w=s.width, start=u.y*w+u.x, goal=new Set(goals.map(p=>p.y*w+p.x));
  const previous=new Int16Array(w*s.height).fill(-2);
  previous[start]=-1;
  const todo=[start];
  for(let head=0;head<todo.length;head++) {
    const k=todo[head];
    if (goal.has(k)) {
      const result=[];
      for(let i=k;i!==start;i=previous[i]) result.push(location(i%w,Math.floor(i/w)));
      return result.reverse();
    }
    for (const p of neighbors(k%w,Math.floor(k/w))) {
      if(!passable(s,u.type,p.x,p.y)) continue;
      const v=p.y*w+p.x;
      if(previous[v]!==-2) continue;
      previous[v]=k; todo.push(v);
    }
  }
  return null;
}
const dest = (s,u,x,y) => passable(s,u.type,x,y) ? [location(x,y)] : [];
const adj = (s,u,x,y) => neighbors(x,y).filter(p=>passable(s,u.type,p.x,p.y));
function yardLaunches(s,x,y) {
  return neighbors(x,y).filter(p=>inside(s,p.x,p.y)&&water(tileAt(s,p.x,p.y)));
}
function site(s,x,y,kind,side) {
  const t=tileAt(s,x,y);
  return (kind==='yard'||kind==='beacon') && (t==='grass'||t==='sand') &&
    !s.buildings.some(b=>at(b,x,y)) && !s.deposits.some(d=>at(d,x,y)) && !s.units.some(u=>u.side!==side&&at(u,x,y)) &&
    (kind!=='yard'||yardLaunches(s,x,y).length>0);
}
export function issue(s,side,cmd) {
  if (!SIDES.includes(side) || !cmd || typeof cmd!=='object'||Array.isArray(cmd)) return bad('invalid','無效指令。');
  if (s.winner) return bad('finished','這一局已經結束。');
  const p=s.players[side];
  const {type,id,ids,x,y,kind}=cmd;
  if (type==='train') {
    const b=s.buildings.find(b=>b.id===id && b.side===side);
    if (!b) return bad('ownership','請選擇自己的建築。');
    if (!ready(s,b)) return bad('pending','建築還在施工。');
    if (!((b.type==='hall'&&kind==='worker')||(b.type==='yard'&&kind==='scout'))) return bad('train-type','這座建築不能訓練該單位。');
    if (b.queue.length>=2) return bad('queue','此建築的訓練佇列已滿。');
    if (s.units.filter(u=>u.side===side).length+s.buildings.filter(b=>b.side===side).reduce((sum,q)=>sum+q.queue.length,0)>=RULES.unitCap) return bad('unit-cap','已達單位上限。');
    if (!affordable(p,COSTS[kind])) return bad('resources','資源不足。');
    charge(p,COSTS[kind]);
    b.queue.push({type:kind,readyTick:(b.queue.at(-1)?.readyTick||s.tick)+(kind==='worker'?16:22)});
    report(s,side,kind==='worker'?'工人訓練中。':'巡航艇建造中。');
    return ok();
  }
  if (!['move','gather','build'].includes(type)||!inside(s,x,y)) return bad('target','這個目標無效。');
  if (!Array.isArray(ids)||!ids.length||ids.length>RULES.unitCap||new Set(ids).size!==ids.length||!ids.every(i=>typeof i==='string')) return bad('selection','請先選取單位。');
  const units=ids.map(i=>s.units.find(u=>u.id===i&&u.side===side));
  if (units.some(u=>!u)) return bad('ownership','請選擇自己的單位。');
  if (type==='move') {
    const plans=units.map(u=>[u,route(s,u,dest(s,u,x,y))]);
    const usable=plans.filter(([,path])=>path!==null);
    if(!usable.length) return bad('terrain','所選單位無法到達。工人走陸地，巡航艇走水道。');
    for(const [u,path] of usable) u.order={type,x,y,path};
    return {ok:true,assigned:usable.length};
  }
  const workers=units.filter(u=>u.type==='worker');
  if(!workers.length) return bad('worker','這項工作需要工人。');
  if(type==='gather') {
    const d=s.deposits.find(d=>at(d,x,y)&&d.remaining>0);
    if(!d) return bad('deposit','這裡沒有可採集的資源。');
    const usable=workers.map(u=>[u,route(s,u,adj(s,u,x,y))]).filter(([,path])=>path!==null);
    if(!usable.length) return bad('terrain','工人無法到達這處資源。');
    for(const [u,path] of usable) u.order={type,x,y,path,depositId:d.id};
    return {ok:true,assigned:usable.length};
  }
  if (!site(s,x,y,kind,side)) return bad('site','無法在此施工：需要空地，船廠還必須臨水。');
  const pathOptions=workers.map(u=>[u,route(s,u,adj(s,u,x,y))]).filter(([,path])=>path!==null).sort((a,b)=>a[1].length-b[1].length);
  if(!pathOptions.length) return bad('terrain','工人無法到達這個工地。');
  if (s.buildings.filter(b=>b.side===side).length>=RULES.buildingCap) return bad('building-cap','已達建築上限。');
  if (!affordable(p,COSTS[kind])) return bad('resources','資源不足。');
  const [u,path]=pathOptions[0];
  charge(p,COSTS[kind]);
  addBuilding(s,side,kind,x,y,s.tick+path.length*2+22);
  u.order={type,x,y,path};
  report(s,side,kind==='yard'?'船廠施工中。':'信標施工中。');
  return ok();
}
function control(s) {
  const c=s.controls[0], counts={A:0,B:0};
  for(const u of s.units) if(u.type==='scout'&&distance(c,u)<=RULES.controlRadius) counts[u.side]++;
  const newSide=counts.A===counts.B?null:counts.A>counts.B?'A':'B';
  if(c.side!==newSide&&newSide) report(s,newSide,'巡航艇已取得浮標控制權。');
  c.side=newSide;c.contested=counts.A===counts.B&&counts.A>0;
  if(!newSide) return;
  const hasBeacon=s.buildings.some(b=>b.side===newSide&&b.type==='beacon'&&ready(s,b));
  s.players[newSide].score=Math.min(RULES.target,s.players[newSide].score+(hasBeacon?5:4));
  if (s.players[newSide].score>=RULES.target) {
    s.winner=newSide;
    s.overReason='signal';
  }
}
function ai(s) {
  const side='B', p=s.players.B, hard=s.difficulty==='hard';
  const workers=s.units.filter(u=>u.side===side&&u.type==='worker');
  const boats=s.units.filter(u=>u.side===side&&u.type==='scout');
  const buildings=s.buildings.filter(b=>b.side===side);
  const hall=buildings.find(b=>b.type==='hall');
  const yard=buildings.find(b=>b.type==='yard');
  const beacon=buildings.find(b=>b.type==='beacon');
  const deposits=s.deposits.filter(d=>d.id.startsWith('dB')&&d.remaining>0);
  const gatherWorker=(u,preferred)=>{
    const d=deposits.slice().sort((a,b)=>(a.type===preferred?0:20)+(workers.filter(w=>w.order?.depositId===a.id).length*4)+distance(a,u)-((b.type===preferred?0:20)+(workers.filter(w=>w.order?.depositId===b.id).length*4)+distance(b,u)))[0];
    if(d) issue(s,side,{type:'gather',ids:[u.id],x:d.x,y:d.y});
  };
  for (const u of workers.filter(u=>!u.order)) gatherWorker(u,p.stone*1.7>p.wood?'wood':'stone');
  const buildNearby=(kind)=>{
    const bb=workers.slice().sort((a,b)=>distance(a,hall)-distance(b,hall));
    for (const u of bb) {
      for(const loc of Array.from({length:s.width*s.height},(_,i)=>location(i%s.width,Math.floor(i/s.width))).filter(q=>q.x>=12&&site(s,q.x,q.y,kind,side)).sort((a,b)=>distance(u,a)-distance(u,b))) {
        if(issue(s,side,{type:'build',kind,ids:[u.id],...loc}).ok) return;
      }
    }
  };
  if(s.tick>=(hard?15:85)&&!yard&&affordable(p,COSTS.yard)) buildNearby('yard');
  if(s.tick>=(hard?120:320)&&!beacon&&yard&&affordable(p,COSTS.beacon)) buildNearby('beacon');
  if(s.tick>=(hard?20:115)&&hall&&workers.length+hall.queue.length<(hard?6:4)) issue(s,side,{type:'train',id:hall.id,kind:'worker'});
  if(s.tick>=(hard?50:190)&&yard&&boats.length+yard.queue.length<(hard?9:5)) issue(s,side,{type:'train',id:yard.id,kind:'scout'});
  if (s.tick>=(hard?45:165)) {
    const targets=[[9,6],[10,6],[9,7],[10,7],[8,6],[9,5],[11,6],[9,8]];
    boats.forEach((u,i)=>{
      if(!u.order&&distance(u,s.controls[0])>RULES.controlRadius) {
        const [x,y]=targets[i%targets.length];
        issue(s,side,{type:'move',ids:[u.id],x,y});
      }
    });
  }
}
export function step(s,n=1) {
  for (let i=0;Number.isInteger(n)&&i<n&&!s.winner;i++) {
    s.tick++;
    if (s.mode==='solo'&&s.tick%(s.difficulty==='hard'?8:16)===0) ai(s);
    for(const b of s.buildings) {
      if(b.readyTick===s.tick) report(s,b.side,b.type==='yard'?'船廠已完工。':'信標已完工。');
      if(b.queue.length && b.queue[0].readyTick<=s.tick) {
        const q=b.queue.shift();
        const candidates=q.type==='scout'?yardLaunches(s,b.x,b.y):neighbors(b.x,b.y).filter(v=>passable(s,q.type,v.x,v.y));
        const p=candidates.sort((a,b)=>s.units.filter(u=>at(u,a.x,a.y)).length-s.units.filter(u=>at(u,b.x,b.y)).length)[0]??b;
        addUnit(s,b.side,q.type,p.x,p.y);
        report(s,b.side,q.type==='scout'?'新巡航艇已下水。':'新工人已就緒。');
      }
    }
    for (const u of s.units) {
      const o=u.order;
      if(!o) continue;
      if(o.path.length) {
        if(u.type==='worker'&&s.tick%2) continue;
        const q=o.path.shift();
        u.x=q.x; u.y=q.y;
      }
      if(o.path.length) continue;
      if(o.type!=='gather') {u.order=null;continue;}
      const d=s.deposits.find(d=>d.id===o.depositId);
      if(!d?.remaining||distance(u,d)!==1) {u.order=null;continue;}
      if(s.tick%4===0) {
        const gathered=Math.min(d.remaining,3);
        d.remaining-=gathered;
        s.players[u.side][d.type]+=gathered;
        if(!d.remaining) {
          report(s,u.side,'這處資源已採完。');
          u.order=null;
        }
      }
    }
    control(s);
    if(s.tick>=RULES.maxTicks&&!s.winner) {
      const a=s.players.A.score,b=s.players.B.score;
      s.winner=a===b?'draw':a>b?'A':'B';
      s.overReason='time';
    }
  }
  return s;
}
