// Dependency-free, in-memory, same-origin room server.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, step, issue, snapshot, TICK_MS } from './engine.js';

const root = dirname(fileURLToPath(import.meta.url));
const CODE = /^[0-9A-F]{10}$/;
const TOKEN = /^Bearer ([0-9a-f]{64})$/;
const scripts = new Set(['app.js','board.js','engine.js','network.js']);
const mime = new Map(Object.entries({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2'}));
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const ERRORS = {
  400:'Invalid request.', 403:'This session cannot access the room.', 404:'Room not found or expired.',
  405:'Method not allowed.', 409:'Room or sequence conflict.', 413:'Request too large.',
  415:'Expected application/json.', 429:'Too many active rooms. Try again later.', 500:'Server error.'
};
class RequestError extends Error {
  constructor(status, message, details = {}) { super(message || ERRORS[status]); Object.assign(this,{status,details}); }
}
function json(res,status,value) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, {...headers, 'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) throw new RequestError(415);
  const cap = 4096;
  if (Number(req.headers['content-length']) > cap) throw new RequestError(413);
  let length = 0;
  const chunks = [];
  // Drain streamed bodies up to the server request timeout without retaining oversized data.
  for await (const chunk of req) {
    length += chunk.length;
    if (length <= cap) chunks.push(chunk);
  }
  if (length > cap) throw new RequestError(413);
  let parsed;
  try { parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RequestError(400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestError(400);
  return parsed;
}

export function makeServer({
  tickMs=TICK_MS, heartbeatMs=6000, graceMs=20000, lobbyMs=180000,
  lifetimeMs=45*60*1000, maxRooms=24, now=()=>performance.now()
}={}) {
  const rooms = new Map();
  const occupants = ['A','B'];
  const player = time => ({token:randomBytes(32).toString('hex'), seen:time, seq:0, pause:false});
  const connected = (seat,time) => !!seat && time-seat.seen < heartbeatMs;
  function prune(time) {
    for (const [code,room] of rooms) {
      if (time-room.born >= lifetimeMs ||
          (!room.B && time-room.born >= lobbyMs) ||
          occupants.some(side => room[side] && time-room[side].seen >= heartbeatMs+graceMs)) rooms.delete(code);
    }
  }
  function envelope(room,role,time,token=false) {
    const links = Object.fromEntries(occupants.map(side=>[side,connected(room[side],time)]));
    return {
      code:room.code, role, ...(token ? {token:room[role].token} : {}),
      ready:!!room.B, paused:!links.A || !links.B || room.A.pause || room.B.pause,
      pauseBy:{A:room.A.pause,B:room.B?.pause ?? false},
      connected:links, graceMs, lastSeq:room[role].seq, snapshot:snapshot(room.game)
    };
  }
  function roleOf(room,req) {
    const auth = TOKEN.exec(req.headers.authorization || '')?.[1];
    const side = auth && occupants.find(side=>room[side]?.token === auth);
    if (!side) throw new RequestError(403);
    return side;
  }
  function advance() {
    const time=now();
    prune(time);
    for (const room of rooms.values()) {
      if (connected(room.A,time) && connected(room.B,time) && !room.A.pause && !room.B.pause && !room.game.winner) step(room.game);
    }
  }
  async function api(req,res,url) {
    // A credentialed room request from a different browser origin is never accepted.
    const origin=req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) throw new RequestError(403);
    const parts=url.pathname.split('/').filter(Boolean);
    const [,resource,code,action,...extra]=parts;
    if (resource !== 'rooms' || extra.length || (code && !CODE.test(code))) throw new RequestError(404);
    if (!code && req.method==='POST') {
      await body(req);
      const time=now(); prune(time);
      if (rooms.size >= maxRooms) throw new RequestError(429);
      let code;
      do { code=randomBytes(5).toString('hex').toUpperCase(); } while (rooms.has(code));
      const room = {code, born:time, game:createGame({seed:randomBytes(4).readUInt32LE(),mode:'duo'}), A:player(time), B:null};
      rooms.set(code,room);
      return json(res,201,envelope(room,'A',time,true));
    }
    if (!code) throw new RequestError(405);
    // Await all I/O before consulting authoritative room state.
    let input;
    if (req.method==='POST') input=await body(req);
    const time=now(); prune(time);
    const room=rooms.get(code);
    if (!room) throw new RequestError(404);
    if (req.method==='POST' && action==='join') {
      if (room.B) throw new RequestError(409,'Both seats are already reserved.');
      if (!connected(room.A,time)) throw new RequestError(409,'Host is not connected.');
      room.B=player(time);
      return json(res,201,envelope(room,'B',time,true));
    }
    if (req.method==='GET' && !action) {
      const role=roleOf(room,req);
      room[role].seen=time;
      return json(res,200,envelope(room,role,time));
    }
    if (req.method!=='POST') throw new RequestError(405);
    if (action !== 'pause' && action !== 'action') throw new RequestError(404);
    const role=roleOf(room,req), seat=room[role];
    if (!Number.isSafeInteger(input.seq) || input.seq !== seat.seq+1) throw new RequestError(409,'Sequence conflict.',{lastSeq:seat.seq});
    if (!room.B) throw new RequestError(409,'Wait for a second player.',{lastSeq:seat.seq});
    if (action==='pause') {
      if (typeof input.paused !== 'boolean') throw new RequestError(400,'Specify whether to pause.',{lastSeq:seat.seq});
      seat.pause=input.paused;
    } else {
      if (!connected(room.A,time) || !connected(room.B,time) || room.A.pause || room.B.pause) throw new RequestError(409,'Room paused or reconnecting.',{lastSeq:seat.seq});
      if (room.game.winner) throw new RequestError(409,'Match is over.',{lastSeq:seat.seq});
      const cmd=input.command;
      if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) throw new RequestError(400,'Invalid command.',{lastSeq:seat.seq});
      if (['move','gather','build'].includes(cmd.type) && (!Array.isArray(cmd.ids) || cmd.ids.length < 1 || cmd.ids.length > 40 || new Set(cmd.ids).size !== cmd.ids.length || cmd.ids.some(id=>typeof id !== 'string'))) throw new RequestError(400,'Invalid unit selection.',{lastSeq:seat.seq});
      const result=issue(room.game,role,cmd);
      if (!result.ok) throw new RequestError(400,result.reason || 'Invalid command.',{lastSeq:seat.seq});
    }
    seat.seq=input.seq;
    seat.seen=time;
    return json(res,200,envelope(room,role,time));
  }

  const server=createServer({requestTimeout:10000,headersTimeout:5000,keepAliveTimeout:4000},async (req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req,res,url);
      if (!['GET','HEAD'].includes(req.method)) throw new RequestError(405);
      let relative;
      try { relative=url.pathname==='/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); }
      catch { throw new RequestError(400); }
      if (!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(relative) || /^(?:server|network-test)(?:\.|$)/.test(relative)) throw new RequestError(404);
      const path=resolve(root,relative), type=mime.get(extname(path));
      if (!path.startsWith(root+sep) || !type || (extname(path)==='.js' && !scripts.has(relative)) || extname(path)==='.mjs') throw new RequestError(404);
      const actual=await realpath(path).catch(()=>{throw new RequestError(404);});
      if (actual !== path) throw new RequestError(404);
      const bytes=await readFile(actual).catch(()=>{throw new RequestError(404);});
      res.writeHead(200,{...headers,'Content-Type':type,'Content-Length':bytes.length});
      res.end(req.method==='HEAD' ? undefined : bytes);
    } catch (err) {
      json(res, err.status || 500, {error:err.status ? err.message : ERRORS[500], ...(err.details || {})});
      if (!err.status) console.error(err);
    }
  });
  server.maxConnections=96;
  const timer=setInterval(advance,tickMs);
  timer.unref();
  server.once('close',()=>clearInterval(timer));
  return server;
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const host=process.env.HOST || '127.0.0.1';
  const port=Number(process.env.PORT || 4100);
  makeServer().listen(port,host,()=>console.log(`Harbor Command • http://${host.includes(':') ? '['+host+']' : host}:${port}`));
}
