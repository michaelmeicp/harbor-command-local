import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './engine.js';
import {renderBoard,boardPoint} from './board.js';

function fakeSvg(){
  let staticWrites=0,dynamicWrites=0,terrain,actors;
  const viewBox={baseVal:{x:0,y:0,width:0,height:0}};
  const layer={set innerHTML(str){actors=str;dynamicWrites++},get innerHTML(){return actors}};
  return {
    viewBox, layer, querySelector:()=>layer,
    setAttribute(k,v){const [x,y,width,height]=v.split(' ').map(Number);viewBox.baseVal={x,y,width,height}},
    set innerHTML(str){terrain=str;staticWrites++},get innerHTML(){return terrain},
    get writes(){return [staticWrites,dynamicWrites]},
    getScreenCTM:()=>({inverse:()=>({a:2,b:2,x:-20,y:-40})}),
    createSVGPoint:()=>({matrixTransform(m){return {x:this.x*m.a+m.x,y:this.y*m.b+m.y}}}),
  };
}

test('chart renders terrain and actors, then caches when nothing visual moves',()=>{
  const svg=fakeSvg(),s=createGame();
  renderBoard(svg,s,{selected:[s.units[0].id]});
  assert.match(svg.innerHTML,/BREAKWATER CHANNEL/);
  assert.match(svg.layer.innerHTML,/#fff1a5/);
  assert.match(svg.layer.innerHTML,/url\(#hc-hull\)/);
  renderBoard(svg,s,{selected:[s.units[0].id]});
  assert.deepEqual(svg.writes,[1,1]);
  s.units[0].x++;
  renderBoard(svg,s,{selected:[s.units[0].id]});
  assert.deepEqual(svg.writes,[1,2]);
});

test('zoom clamps at board corners and pointer maps via inverse screen transform',()=>{
  const svg=fakeSvg();
  renderBoard(svg,createGame(),{zoom:2,focus:{x:0,y:0}});
  assert.deepEqual(svg.viewBox.baseVal,{x:0,y:0,width:400,height:280});
  assert.deepEqual(boardPoint(svg,{clientX:31,clientY:41}),{x:1,y:1});
  assert.equal(boardPoint(svg,{clientX:10,clientY:19}),null);
  assert.equal(boardPoint(svg,{clientX:210,clientY:20}),null);
  renderBoard(svg,createGame(),{zoom:2,focus:{x:19,y:13}});
  assert.deepEqual(svg.viewBox.baseVal,{x:400,y:280,width:400,height:280});
  assert.equal(boardPoint(svg,{clientX:31,clientY:41}),null);
});
