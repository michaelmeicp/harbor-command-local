// Original SVG chart and sprites. Artwork uses only procedural paths and primitives.
import {RULES} from './engine.js';
const T=40, roots=new WeakMap();
const crew={A:'#7ae4fa',B:'#ff9783',neutral:'#f4d17e'};
const r=(x,y,k=0)=>{let n=Math.imul(x+41,374761393)+Math.imul(y+71,668265263)+Math.imul(k,18585267);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295};
const tile=(s,x,y)=>s.tiles[y]?.[x]??'water';
const dry=(s,x,y)=>!['water','dock'].includes(tile(s,x,y));
const tr=(x,y)=>`translate(${x} ${y})`;
const ellipse=(x,y,rx,ry,fill,extra='')=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const path=(d,fill,extra='')=>`<path d="${d}" fill="${fill}" ${extra}/>`;

function outline(s) {
  const edges=new Map();
  const add=(a,b,c,d)=>{
    const key=a+','+b;
    const list=edges.get(key)??[];
    list.push([[a*T,b*T],[c*T,d*T],[c,d]]);
    edges.set(key,list);
  };
  for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++)if(dry(s,x,y)){
    if(!dry(s,x,y-1))add(x,y,x+1,y);
    if(!dry(s,x+1,y))add(x+1,y,x+1,y+1);
    if(!dry(s,x,y+1))add(x+1,y+1,x,y+1);
    if(!dry(s,x-1,y))add(x,y+1,x,y);
  }
  const next=k=>{const list=edges.get(k);const e=list?.shift();if(!list?.length)edges.delete(k);return e};
  let d='';
  while(edges.size){
    const first=edges.keys().next().value, pts=[];
    let k=first,e;
    while((e=next(k))){pts.push(e[0]); k=e[2].join(','); if(k===first)break;}
    if(pts.length<3)continue;
    const lerp=(a,b,p)=>[a[0]+(b[0]-a[0])*p,a[1]+(b[1]-a[1])*p].join(' ');
    d+='M'+lerp(pts.at(-1),pts[0],.82);
    for(let i=0;i<pts.length;i++){
      const p=pts[i],n=pts[(i+1)%pts.length];
      d+='Q'+p.join(' ')+' '+lerp(p,n,.18)+'L'+lerp(p,n,.82);
    }
    d+='Z';
  }
  return d;
}

const defs=`<defs>
 <linearGradient id="hc-sea" x2=".77" y2="1"><stop stop-color="#246773"/><stop offset=".51" stop-color="#145662"/><stop offset="1" stop-color="#113b4a"/></linearGradient>
 <linearGradient id="hc-sand" x2=".34" y2="1"><stop stop-color="#f4d69a"/><stop offset="1" stop-color="#bd955b"/></linearGradient>
 <linearGradient id="hc-hull" x2="0" y2="1"><stop stop-color="#fcdfab"/><stop offset="1" stop-color="#ad7752"/></linearGradient>
 <pattern id="hc-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#daefdf" stroke-width=".6" opacity=".16"/></pattern>
</defs>`;

function art(s){
  const W=T*s.width,H=T*s.height,d=outline(s);
  let surface='',decor='',wave='',dock='';
  for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
    const type=tile(s,x,y),xx=x*T,yy=y*T,j=r(x,y),k=r(x,y,3);
    if(type==='water'){
      const a=xx+2+j*14,b=yy+7+k*19;
      wave+=path(`M${a} ${b} q5 -2 10 0t10 0 m-13 5q4 -2 8 0`,'none',`stroke="#abdad0" stroke-width="1.2" opacity="${j>.82?.38:.16}" stroke-linecap="round"`);
    }
    if(type==='grass'||type==='rock'){
      const fills=type==='rock'?['#9a9a83','#aaa38a','#a19e85']:['#879d62','#819760','#8ea369','#96a66c','#899e64'];
      const inset=(dx,dy)=>tile(s,x+dx,y+dy)==='grass'||tile(s,x+dx,y+dy)==='rock'?-.5:4;
      const l=xx+inset(-1,0),t=yy+inset(0,-1),rr=xx+T-inset(1,0),bb=yy+T-inset(0,1);
      surface+=`<rect x="${l}" y="${t}" width="${rr-l}" height="${bb-t}" rx="${[[-1,0],[1,0],[0,1],[0,-1]].every(([a,b])=>inset(a,b)<0)?0:5}" fill="${fills[Math.floor(j*fills.length)%fills.length]}"/>`;
      if(type==='rock')decor+=`<g transform="${tr(xx+10+k*12,yy+15+j*8)}" opacity=".63">${ellipse(6,9,12,5,'#6a775f')}${path('M-5 7 0-2 8-4 14 2 12 8Z','#5c6d65')}${path('M0-2 8-4 14 2 6 3Z','#c3c6a9')}</g>`;
      if(type==='grass'&&j>.49){
        const a=xx+8+k*21,b=yy+11+j*21;
        decor+=path(`M${a} ${b}l-3-4m3 4v-6m0 6 4-4 M${a+8} ${b+3}l2-4`,'none','stroke="#526a45" stroke-width="1.4" stroke-linecap="round" opacity=".49"');
        if(j>.89) decor+=ellipse(a-5,b+2,1.8,1.3,'#e4d091');
      }
    }
    if(type==='sand'){
      decor+=ellipse(xx+5+22*j,yy+8+18*k,1.2,.7,'#916e4d','opacity=".55"')+ellipse(xx+12+22*k,yy+17+18*j,1.4,.85,'#916e4d','opacity=".55"');
    }
    if(type==='dock'){
      let boards='';for(let i=5;i<38;i+=6)boards+=path(`M4 ${i}H36`,'none','stroke="#574638" opacity=".65" stroke-width="1.2"');
      dock+=`<g transform="${tr(xx,yy)}"><rect x="2" y="4" width="36" height="36" rx="3" fill="#132f39"/><rect x="3" y="1" width="34" height="36" rx="2" fill="#a98158" stroke="#dfc18e"/>${boards}${ellipse(5,3,2,2,'#604833')}${ellipse(35,3,2,2,'#604833')}${ellipse(5,35,2,2,'#604833')}${ellipse(35,35,2,2,'#604833')}</g>`;
    }
  }
  const compass=`<g transform="${tr(W-28,29)}" fill="none" stroke="#d1e9d2" opacity=".66"><circle r="13" stroke-width=".7"/><path d="M0-16 4 4 0 1-4 4Z" fill="#d1e9d2"/><path d="M-18 0h9m18 0h9M0 11v7"/><text x="0" y="29" fill="#d1e9d2" stroke="none" font-size="9" text-anchor="middle" font-family="monospace">N</text></g>`;
  return defs+`<rect width="${W}" height="${H}" fill="url(#hc-sea)"/>`+wave+
   path(d,'#6cbeb1','stroke="#8dd0b8" stroke-width="22" opacity=".28"')+
   path(d,'#82c9b2','stroke="#8bdac1" stroke-width="10" opacity=".48" transform="translate(0 3)"')+
   path(d,'#926e48','stroke="#7d664d" stroke-width="4" transform="translate(0 3)"')+
   `<clipPath id="hc-land"><path d="${d}"/></clipPath>`+
   path(d,'url(#hc-sand)')+`<g clip-path="url(#hc-land)">${surface}${decor}</g>`+
   path(d,'none','stroke="#fae2a8" stroke-width="1.7" opacity=".72"')+dock+
   `<g fill="#c9ece0" font-size="9" font-family="monospace" opacity=".64" letter-spacing="2"><text x="16" y="22">HC / 01</text><text x="16" y="37">BREAKWATER CHANNEL</text></g>`+
   `<rect width="${W}" height="${H}" fill="url(#hc-grid)"/>`+compass;
}

function deposit(o,capacity){
  const empty=o.remaining<=0;
  let shape='';
  if(o.type==='wood'){
    for(const [x,y,h] of [[-9,5,19],[1,-1,25],[11,8,17]]){
      shape+=`<g transform="${tr(x,y)}"><path d="M-2 7L-1-7H2L2 7Z" fill="#76523d"/>`;
      if(!empty)shape+=path(`M0 -${h} 8-4 5-4 10 2-10 2-5-4-8-4Z`,'#264e39','stroke="#203b2e" stroke-width=".9"')+path(`M0 -${h} 0 0-9 1-4-5-7-4Z`,'#4e7344');
      else shape+=ellipse(0,0,3,1.3,'#dbab6b');
      shape+='</g>';
    }
  }else{
    for(const [x,y,z] of [[-8,5,.85],[3,-4,1.12],[10,7,.68]]){
      shape+=`<g transform="${tr(x,y)} scale(${empty?z*.45:z})">${path('M-10 2-5-9 4-12 10-4 9 5 1 9-7 7Z','#697b82','stroke="#40565e"')}${path('M-5-9 4-12 10-4 1-1-10 2Z','#c5c3a6')}${path('M-10 2 1-1 1 9-7 7Z','#89958b')}</g>`;
    }
  }
  const fill=o.type==='wood'?'#f2cb7b':'#c2dfed';
  const n=Number.isFinite(o.remaining)?o.remaining:0;
  return ellipse(0,11,16,5,'#36513d','opacity=".43"')+shape+
    (empty?'':`<rect x="-14" y="15" width="28" height="5" rx="2.5" fill="#253b37" opacity=".86"/><rect x="-13" y="16" width="${Math.min(26,Math.max(2,26*n/capacity))}" height="3" rx="1.5" fill="${fill}"/>`);
}

function structure(o){
  const c=crew[o.side]??crew.neutral;
  const base=ellipse(2,13,20,6,'#233f42','opacity=".54"')+path('M-20 9 1 1 21 8 2 18Z','#aca785','stroke="#6d7665"');
  const flag=path('M11 0v-26m0 0 12 4-12 6','none',`stroke="#262f31" stroke-width="2" stroke-linejoin="round"`)+path('M12-25l11 3-11 6Z',c);
  if(o.type==='beacon')return base+ellipse(0,9,11,4,'#5c655b')+
    path('M-8 9-5-12H5L8 9Z','#f2e0ab','stroke="#664f40"')+path('M-7 0H7L8 5H-8Z',c)+
    path('M-6-12v-7h12v7Z','#213b47','stroke="#563b36" stroke-width="1.5"')+
    path('M-8-19 0-25 8-19Z','#b56850')+ellipse(0,-15,3,2,'#ffdf92')+path('M-12-16h-5m29 0h5','none','stroke="#ffe2a0" stroke-width="1.4" opacity=".85"')+flag;
  if(o.type==='yard')return base+path('M-17 5v-13l17-5 16 5V7L0 14Z','#af9470','stroke="#504f43"')+
    path('M0-7v20l16-7v-14Z','#806449')+path('M-20-8-8-18 13-14 19-7 0 0Z','#537485','stroke="#243f4a" stroke-width="1.5"')+
    path('M-16-9-2-15m-10 8 15-6m-7 9 15-6','none','stroke="#709dad" stroke-width="1.15"')+path('M-11 1v8l7-2V0Z','#493f38')+flag;
  return base+path('M-16 7v-16L0-15l16 6V7L0 15Z','#f7deae','stroke="#544e40"')+
    path('M0-2v17l16-8V-9Z','#b2956c')+
    path('M-20-8 0-23l20 15L0 1Z',c,'stroke="#254553" stroke-width="1.65"')+
    path('M0-22 19-8 0 0Z','#274956','opacity=".48"')+
    path('M-12-10 0-19 13-10m-18 3 5-3 5 3','none','stroke="#f7faf1" stroke-width="1.15" opacity=".7"')+
    path('M-11 4v5l6 3V6Z','#504d40')+path('M7 1l5-2v4L7 5Z','#514d3d')+flag;
}

function station(o){
  const color=o.contested?'#fee6c4':crew[o.side]??crew.neutral;
  const radius=RULES.controlRadius*T+T*.5;
  return path(`M0 ${-radius} ${radius} 0 0 ${radius} ${-radius} 0Z`,'none',`stroke="${color}" stroke-width="1.5" stroke-dasharray="3 5" opacity=".52"`)+ellipse(0,7,17,6,'#2b5960','opacity=".48"')+
    `<circle r="16" fill="#103c4a" fill-opacity=".7" stroke="${color}" stroke-width="2" stroke-dasharray="3 2"/>`+
    path('M-8 5-4-2H4l4 7-8 5Z','#ebc784','stroke="#313b35" stroke-width="1.5"')+
    path('M0 3v-20 l11 4-11 6',color,'stroke="#26343b" stroke-width="1.7" stroke-linejoin="round"')+
    ellipse(0,5,2,1.4,'#f9e6af');
}

function sprite(o,s,selected){
  const c=crew[o.side]??crew.neutral;
  const t=tile(s,o.x,o.y);
  const boat=o.type==='scout'&&(t==='water'||t==='dock');
  const base=ellipse(0,9,12,5,'#1f3a3d','opacity=".55"');
  const halo=selected?`<circle r="16" cy="0" fill="#fff0bb" fill-opacity=".25" stroke="#21323c" stroke-width="4"/><circle r="16" fill="none" stroke="#fff0ad" stroke-width="2.1"/>`:'';
  if(boat)return base+halo+path('M-16 8q14 6 33-2M-10 12q10 4 23 0','none','stroke="#ccf1ec" opacity=".6" stroke-width="1.1"')+
    path('M-14 2-8 9h15l8-8-13 3Z','url(#hc-hull)','stroke="#24363c" stroke-width="1.5"')+
    path('M0 4v-17l13 14Z',c,'stroke="#203640" stroke-width="1.4" stroke-linejoin="round"')+
    path('M-2-10 -9 1h7Z','#f9d999','stroke="#3f4a4d" stroke-width="1.1"');
  const scout=o.type==='scout';
  return base+halo+
    path('M-9 3-6-5 5-6 9 3 5 11H-5Z',c,'stroke="#24363c" stroke-width="1.8"')+
    path('M-4 6h8m-6-5v5m4-5v5','none','stroke="#456a6d" stroke-width="1"')+
    ellipse(0,-7,6,5,'#f2be8b','stroke="#373f3b" stroke-width="1.3"')+
    (scout?path('M-7-8-4-13H4l3 4L1-6Z','#4a5961','stroke="#333b3c" stroke-width="1"')+
      path('M9 1v-15l8 3-8 4Z',c,'stroke="#24363c" stroke-width="1.4" stroke-linejoin="round"'):
      path('M-8-8H8L3-12h-7Z','#ffdf91','stroke="#614c3c" stroke-width="1"')+
      path('M8 7l5-8m-2 0 4 2','none','stroke="#5a5445" stroke-width="2" stroke-linecap="round"'));
}

const centered=(o,markup)=>`<g transform="${tr((o.x+.5)*T,(o.y+.5)*T)}">${markup}</g>`;
export function renderBoard(svg,state,{selected=[],focus=null,side='A',zoom=1}={}){
  if(!svg||!state)return;
  const W=state.width*T,H=state.height*T;
  let prev=roots.get(svg);
  const key=state.tiles.map(row=>row.join(',')).join(';');
  if(!prev||prev.key!==key){
    svg.innerHTML=`<g class="map-terrain">${art(state)}</g><g class="map-actors"></g>`;
    prev={key,layer:svg.querySelector('.map-actors'),capacity:new Map()};
    roots.set(svg,prev);
  }
  if(prev.seed!==state.seed||state.tick<prev.tick){prev.capacity.clear();prev.seed=state.seed;}
  prev.tick=state.tick;
  for(const o of state.deposits??[])prev.capacity.set(o.id,Math.max(1,o.remaining,prev.capacity.get(o.id)??0));
  const z=Number.isFinite(zoom)?Math.min(2.5,Math.max(1,zoom)):1;
  const w=W/z,h=H/z;
  const vx=Math.max(0,Math.min(W-w,((focus?.x+.5)||state.width/2)*T-w/2));
  const vy=Math.max(0,Math.min(H-h,((focus?.y+.5)||state.height/2)*T-h/2));
  svg.setAttribute('viewBox',`${vx} ${vy} ${w} ${h}`);
  const list=state.units??[], set=new Set(selected);
  let out='';
  if(focus)out+=`<rect x="${focus.x*T+1.5}" y="${focus.y*T+1.5}" width="37" height="37" rx="5" fill="#fff9dd" fill-opacity=".13" stroke="#fff1c0" stroke-width="1.65" stroke-dasharray="4 2"/>`;
  for(const o of list)if(o.side===side&&set.has(o.id)&&o.order&&Number.isInteger(o.order.x)&&Number.isInteger(o.order.y)){
    out+=path(`M${(o.x+.5)*T} ${(o.y+.5)*T}L${(o.order.x+.5)*T} ${(o.order.y+.5)*T}`,'none','stroke="#fff3b3" stroke-width="1.25" stroke-dasharray="3 4" opacity=".7"')+
      ellipse((o.order.x+.5)*T,(o.order.y+.5)*T,4,4,'none','stroke="#ffedb0" opacity=".8"');
  }
  for(const b of state.controls??[])out+=centered(b,station(b));
  const sprites=[...(state.deposits??[]).map(o=>[o,deposit(o,prev.capacity.get(o.id))]), ...(state.buildings??[]).map(o=>[o,
    (set.has(o.id)?'<rect x="-19" y="-19" width="38" height="38" rx="6" fill="#fff9dd" fill-opacity=".2" stroke="#fff1c0" stroke-width="2"/>':'')+
    (o.readyTick>state.tick?`<g opacity=".5">${structure(o)}</g><path d="M-16 13h32" stroke="#4a4c44" stroke-width="5"/><path d="M-15 13h30" stroke="#ffdf88" stroke-width="3" stroke-dasharray="3 2"/>`:structure(o))]), ...list.map(o=>[o,sprite(o,state,set.has(o.id))])];
  sprites.sort((a,b)=>a[0].y-b[0].y);
  for(const [o,shape] of sprites)out+=centered(o,shape);
  // Keep selection visible even when an adjacent tree or roof overlaps a sprite.
  for(const o of list)if(set.has(o.id))out+=centered(o,path('M-6-17 0-12 6-17Z','#fff1a5','stroke="#2a3f42" stroke-width="1.2"'));
  if(prev.markup!==out){prev.layer.innerHTML=out;prev.markup=out;}
}

export function boardPoint(svg,event){
  const ctm=svg.getScreenCTM();
  if(!ctm)return null;
  const p=svg.createSVGPoint();
  p.x=event.clientX;p.y=event.clientY;
  const m=p.matrixTransform(ctm.inverse());
  const v=svg.viewBox.baseVal;
  if(m.x<v.x||m.y<v.y||m.x>=v.x+v.width||m.y>=v.y+v.height)return null;
  return {x:Math.floor(m.x/T),y:Math.floor(m.y/T)};
}
