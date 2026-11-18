import test from 'node:test';
import assert from 'node:assert/strict';
import { COSTS, RULES, createGame, issue, snapshot, step } from './engine.js';

const command = (s,type,fields={},side='A') => issue(s,side,{type,...fields});
const gather = (s,id,x,y) => command(s,'gather',{ids:[id],x,y});
const go = (s,id,x,y,side) => command(s,'move',{ids:[id],x,y},side);
const build = (s,id,kind,x,y) => command(s,'build',{kind,ids:[id],x,y});
const train = (s,id,kind) => command(s,'train',{id,kind});
const player = (s,side='A') => s.players[side];
const balance = p => ({wood:p.wood,stone:p.stone});
const own = (collection,side='A') => collection.filter(v=>v.side===side);

test('same seed and orders yield identical maps, economy, AI, and winner',()=>{
  const setup = seed => {
    const s=createGame({seed,difficulty:'hard'});
    assert.equal(gather(s,'u2',5,8).ok,true);
    assert.equal(go(s,'u4',9,6).ok,true);
    step(s,120);
    assert.equal(build(s,'u3','yard',7,8).ok,true);
    step(s,900);
    return s;
  };
  const a=setup(222), b=setup(222), c=setup(223);
  assert.deepEqual(snapshot(a),snapshot(b));
  assert.notDeepEqual(a.tiles,c.tiles);
  assert.notEqual(snapshot(a).units,a.units);
});

test('valid passability, mirrored deposits, and reachable openings across 30 seeds',()=>{
  for(let seed=0;seed<30;seed++) {
    const s=createGame({seed,mode:'duo'});
    assert.equal(s.tiles.length,RULES.height);
    for(const r of s.tiles) assert.equal(r.length,RULES.width);
    for(const v of s.units) {
      const t=s.tiles[v.y][v.x];
      assert.equal(t==='water',v.type==='scout');
    }
    assert.deepEqual(s.deposits.slice(0,4).map(d=>d.remaining),s.deposits.slice(4).map(d=>d.remaining));
    assert.equal(gather(s,'u2',5,8).ok,true);
    assert.equal(command(s,'gather',{ids:['u6'],x:14,y:10},'B').ok,true);
    assert.equal(go(s,'u4',9,6).ok,true);
    assert.equal(go(s,'u8',9,6,'B').ok,true);
    step(s,14);
    assert.equal(s.controls[0].contested,true);
    assert.equal(s.controls[0].side,null);
    assert.equal(build(s,'u3','yard',7,8).ok,true);
  }
});

test('gathering tenaciously drains a finite deposit once even with overlapping workers',()=>{
  const s=createGame({mode:'duo'});
  const d=s.deposits.find(d=>d.id==='dA0');
  const total=d.remaining+player(s).wood;
  assert.equal(command(s,'gather',{ids:['u2','u3'],x:d.x,y:d.y}).assigned,2);
  step(s,500);
  assert.equal(d.remaining,0);
  assert.equal(player(s).wood,total);
  assert.equal(own(s.units).some(u=>u.order),false);
  assert.equal(s.events.filter(e=>e.text.includes('採完')).length,1);
  assert.equal(gather(s,'u2',d.x,d.y).code,'deposit');
  step(s,200);
  assert.equal(player(s).wood,total);
});

test('illegal selection, ownership, terrain, sites and cost are rejected atomically',()=>{
  const s=createGame({mode:'duo'});
  const before=snapshot(s);
  assert.equal(go(s,'u6',16,8).code,'ownership');
  assert.equal(command(s,'move',{ids:['u2','u2'],x:5,y:8}).code,'selection');
  assert.equal(command(s,'move',{ids:['u2','u6'],x:5,y:8}).code,'ownership');
  assert.equal(go(s,'u2',14,8).code,'terrain');
  assert.equal(go(s,'u4',4,7).code,'terrain');
  assert.equal(go(s,'u4',10.5,7).code,'target');
  assert.equal(gather(s,'u4',5,8).code,'worker');
  assert.equal(build(s,'u2','yard',5,8).code,'site');
  assert.equal(build(s,'u2','yard',4,8).code,'site');
  assert.equal(build(s,'u2','beacon',4,9).code,'resources');
  assert.equal(train(s,'b5','worker').code,'ownership');
  assert.equal(train(s,'b1','scout').code,'train-type');
  assert.deepEqual(s,before);
  assert.equal(command(s,'move',{ids:['u2','u4'],x:6,y:8}).assigned,1);
  assert.equal(s.units.find(u=>u.id==='u4').order,null);
});

test('construction, launch, worker queue and late retasking preserve resources and resolve',()=>{
  const s=createGame({mode:'duo'});
  gather(s,'u2',5,8); gather(s,'u3',5,10);
  step(s,52);
  let p=player(s), before=balance(p);
  assert.equal(build(s,'u2','yard',7,8).ok,true);
  assert.equal(p.wood,before.wood-COSTS.yard.wood);
  assert.equal(p.stone,before.stone-COSTS.yard.stone);
  const yard=own(s.buildings).find(b=>b.type==='yard');
  assert.equal(train(s,yard.id,'scout').code,'pending');
  assert.equal(build(s,'u2','yard',7,8).code,'site');
  // New orders do not cancel committed construction.
  assert.equal(gather(s,'u2',5,8).ok,true);
  step(s,36);
  assert.ok(yard.readyTick<=s.tick);
  assert.equal(train(s,yard.id,'scout').ok,true);
  assert.equal(train(s,'b1','worker').ok,true);
  step(s,24);
  const b=own(s.units).find(u=>u.type==='scout'&&u.id!=='u4');
  assert.ok(b);
  assert.equal(own(s.units).filter(u=>u.type==='worker').length,3);
  assert.ok(['water','dock'].includes(s.tiles[b.y][b.x]));
  assert.equal(go(s,b.id,9,6).ok,true);
  assert.equal(go(s,'u4',9,6).ok,true);
  step(s,10);
  assert.deepEqual(own(s.units).filter(u=>u.type==='scout').map(({x,y,order})=>({x,y,order})),[{x:9,y:6,order:null},{x:9,y:6,order:null}]);
});

test('building and unit limits include pending work; stock never goes negative',()=>{
  const s=createGame({mode:'duo'});
  Object.assign(player(s),{wood:10000,stone:10000});
  for(const [x,y] of [[7,8],[7,10],[6,5],[6,6],[6,7]]) assert.equal(build(s,'u2','beacon',x,y).ok,true);
  assert.equal(build(s,'u2','beacon',4,9).code,'building-cap');
  assert.equal(train(s,'b1','worker').ok,true);
  assert.equal(train(s,'b1','worker').ok,true);
  assert.equal(train(s,'b1','worker').code,'queue');
  step(s,34);
  for(let i=0;i<9;i++) {
    assert.equal(train(s,'b1','worker').ok,true);
    step(s,17);
  }
  assert.equal(own(s.units).length,RULES.unitCap);
  assert.equal(train(s,'b1','worker').code,'unit-cap');
  assert.ok(player(s).wood>=0 && player(s).stone>=0);
});

test('beginner can gather, build both buildings, train, capture and beat easy AI',()=>{
  const s=createGame();
  gather(s,'u2',5,8); gather(s,'u3',5,10); go(s,'u4',9,6);
  step(s,40);
  assert.equal(build(s,'u2','yard',7,8).ok,true);
  assert.equal(build(s,'u3','beacon',4,9).ok,true);
  gather(s,'u2',5,8); gather(s,'u3',5,10);
  step(s,45);
  const yard=own(s.buildings).find(b=>b.type==='yard');
  assert.equal(train(s,yard.id,'scout').ok,true);
  step(s,25);
  const newBoat=own(s.units).find(u=>u.type==='scout'&&u.id!=='u4');
  assert.equal(go(s,newBoat.id,9,7).ok,true);
  step(s,600);
  assert.equal(s.winner,'A');
  assert.equal(s.overReason,'signal');
  assert.equal(player(s).score,RULES.target);
  assert.equal(go(s,'u4',9,7).code,'finished');
  const tick=s.tick;
  step(s,600);
  assert.equal(s.tick,tick);
});

test('AI wins if A ignores competition; hard pressures earlier; empty duo ends as draw',()=>{
  const a=createGame(), b=createGame({difficulty:'hard'}), c=createGame({mode:'duo'});
  for(const s of [a,b,c]) step(s,1800);
  assert.equal(a.winner,'B'); assert.equal(b.winner,'B');
  assert.ok(b.tick<a.tick);
  assert.ok(own(a.units,'B').length>3 && own(b.units,'B').length>3);
  assert.equal(c.winner,'draw'); assert.equal(c.tick,RULES.maxTicks); assert.equal(c.overReason,'time');
});

test('match timer respects earned progress after scouts leave the signal range',()=>{
  const s=createGame({mode:'duo'});
  assert.equal(go(s,'u4',9,6).ok,true); step(s,20);
  assert.ok(player(s).score>0);
  assert.equal(go(s,'u4',8,9).ok,true);
  step(s,RULES.maxTicks);
  assert.equal(s.controls[0].side,null);
  assert.equal(s.winner,'A'); assert.equal(s.overReason,'time');
});
