import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeServer } from './server.js';

async function fixture(t,options={}) {
  const server=makeServer({tickMs:15,...options});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return async (path, {data,token,origin}={}) => {
    const headers={};
    if (token) headers.Authorization='Bearer '+token;
    if (origin) headers.Origin=origin;
    if (data !== undefined) headers['Content-Type']='application/json';
    const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers,body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,...await response.json()};
  };
}
const lobby='/api/rooms';

async function room(request) {
  const a=await request(lobby,{data:{}});
  const path=lobby+'/'+a.code;
  const b=await request(path+'/join',{data:{}});
  assert.equal(a.status,201);
  assert.equal(b.status,201);
  assert.equal(a.role,'A');
  assert.equal(b.role,'B');
  assert.equal(a.ready,false);
  assert.equal(b.ready,true);
  assert.equal(b.paused,false);
  assert.match(a.code,/^[A-F0-9]{10}$/);
  assert.notEqual(a.token,b.token);
  return {a,b,path};
}

test('two independent sessions see authoritative play; rejects trespass, malformed, skipped and replayed commands',async t=>{
  const request=await fixture(t);
  const {a,b,path}=await room(request);
  assert.equal((await request(path)).status,403);
  assert.equal((await request(path,{token:a.token,origin:'https://elsewhere.example'})).status,403);
  assert.equal((await request(path+'/join',{data:{}})).status,409);
  const {units}=b.snapshot;
  const unitA=units.find(u=>u.side==='A');
  assert.ok(unitA);
  const target={x:unitA.x+2,y:unitA.y};
  const command={type:'move',ids:[unitA.id],...target};
  const post=(client,seq,cmd=command)=>request(path+'/action',{token:client.token,data:{seq,command:cmd}});
  assert.equal((await post(b,1)).status,400,'B may not move an A unit');
  assert.equal((await post(a,2)).status,409,'cannot skip a sequence number');
  assert.equal((await post(a,1,{...command,x:-100})).status,400,'cannot move off-map');
  assert.equal((await post(a,1,{...command,ids:[unitA.id,unitA.id]})).status,400,'cannot duplicate unit IDs');
  const valid=await post(a,1);
  assert.equal(valid.status,200,valid.error);
  assert.equal(valid.lastSeq,1);
  assert.equal((await post(a,1)).status,409,'duplicate replay must fail');
  const deadline=performance.now()+2200;
  let observed;
  do {
    await sleep(30);
    observed=await request(path,{token:b.token});
    if (observed.snapshot.units.some(u=>u.id===unitA.id && u.x===target.x && u.y===target.y)) break;
  } while (performance.now() < deadline);
  assert.ok(observed.snapshot.tick>valid.snapshot.tick);
  assert.ok(observed.snapshot.units.some(u=>u.id===unitA.id && u.x===target.x && u.y===target.y),'B sees actual arrival');
  const same=await request(path,{token:a.token});
  assert.equal(same.snapshot.units.find(u=>u.id===unitA.id).x,target.x);
  assert.equal(observed.lastSeq,0);
  assert.equal(same.lastSeq,1);
  assert.equal(same.token,undefined);
});

test('pause seats independently; missed heartbeat pauses, same token reattaches within grace, then expiry',async t=>{
  let time=0;
  const request=await fixture(t,{heartbeatMs:100,graceMs:250,now:()=>time});
  const {a,b,path}=await room(request);
  const poll=client=>request(path,{token:client.token});
  const pause=(client,seq,paused)=>request(path+'/pause',{token:client.token,data:{seq,paused}});
  const started=await pause(a,1,true);
  assert.equal(started.paused,true);
  assert.equal(started.pauseBy.A,true);
  assert.equal((await pause(b,1,false)).paused,true,'B cannot release A pause');
  await sleep(60);
  assert.equal((await poll(b)).snapshot.tick,started.snapshot.tick);
  assert.equal((await pause(a,2,false)).paused,false);
  await sleep(60);
  const latest=await poll(b);
  assert.ok(latest.snapshot.tick>started.snapshot.tick);
  time=150;
  const dropped=await poll(b);
  assert.equal(dropped.connected.A,false);
  assert.equal(dropped.paused,true);
  await sleep(45);
  assert.equal((await poll(b)).snapshot.tick,dropped.snapshot.tick);
  const recovered=await poll(a);
  assert.equal(recovered.connected.A,true);
  assert.equal(recovered.paused,false);
  assert.equal(recovered.lastSeq,2);
  time=500;
  assert.equal((await poll(a)).status,404);
});

test('bounded room count and lobby lifetime',async t=>{
  let time=0;
  const request=await fixture(t,{maxRooms:1,lobbyMs:30,now:()=>time});
  const a=await request(lobby,{data:{}});
  assert.equal(a.status,201);
  assert.equal((await request(lobby,{data:{}})).status,429);
  time=31;
  assert.equal((await request(lobby+'/'+a.code,{token:a.token})).status,404);
  assert.equal((await request(lobby,{data:{}})).status,201);
});

test('serves play files without exposing private test/server sources',async t=>{
  const server=makeServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const get=path=>fetch(base+path);
  const html=await get('/');
  assert.equal(html.status,200);
  assert.match(await html.text(),/Harbor Command/);
  const module=await get('/engine.js');
  assert.equal(module.status,200);
  assert.match(module.headers.get('content-type'),/javascript/);
  await module.text();
  for (const path of ['/server.js','/network.test.js','/package.json','/%']) {
    const denied=await get(path);
    assert.equal(denied.status,path==='/%'?400:404);
    await denied.text();
  }
});
