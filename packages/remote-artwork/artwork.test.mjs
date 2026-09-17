import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import './artwork.js';

const api = globalThis.DroidexArtwork;
const root = new URL('../../', import.meta.url);
const asset = (name) => readFile(new URL('public/remote-artwork/'+name,root),'utf8');

test('the device preserves the documented iPhone 17 Pro body proportions', async () => {
  const model = JSON.parse(await readFile(new URL('./device.json',import.meta.url),'utf8'));
  assert.equal(model.bodyMillimeters.width / model.bodyMillimeters.height, 71.9 / 150);
  assert.match(api.renderDevice(), /width="359.5" height="750"/);
  assert.ok(Math.abs(359.5 / 750 - model.bodyMillimeters.width / model.bodyMillimeters.height) < Number.EPSILON);
  assert.match(api.renderDevice(), /Not an official Apple asset/);
});

test('every morph uses compatible cubic topology and finite, nonzero geometry', () => {
  const signature = (path) => path.match(/[A-Za-z]/g).join('');
  const reference = signature(api.roundedPath(api.states.intro.shape));
  for (const phase of api.phaseNames) {
    const shape = api.states[phase].shape;
    assert.ok(shape.every(Number.isFinite));
    assert.ok(shape[2] > 0 && shape[3] > 0 && shape[4] > 0);
    assert.equal(signature(api.roundedPath(shape)), reference);
    assert.doesNotMatch(api.roundedPath(shape), /NaN|Infinity/);
  }
});

test('unknown states cannot falsely display a successful connection', () => {
  assert.match(api.renderScene('unexpected-provider-value'), /data-phase="intro"/);
  assert.match(api.renderScene('__proto__'), /data-phase="intro"/);
  assert.match(api.renderScene('error'), /data-phase="error"/);
});

test('the share guide is self-contained vector content without a credential or scannable QR', async () => {
  const svg = await asset('droidex-pairing-guide.svg');
  assert.doesNotMatch(svg, /<script|<image|foreignObject|@font-face|DX[12]\.|Bearer |data:image/i);
  for (const text of ['Settings → Remote','Scan QR','Approve your phone','same trusted network','New code']) assert.ok(svg.includes(text));
  assert.match(svg, /ILLUSTRATED GUIDE/);
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match)=>match[1]);
  assert.equal(ids.length,new Set(ids).size);
});

test('the HTML viewer locks its script hash, denies network access, and has a static SVG fallback', async () => {
  const html = await asset('droidex-artwork.html');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${hash}'`));
  assert.ok(html.includes("connect-src 'none'"));
  assert.match(html, /<div id="art" aria-hidden="true"><svg/);
  assert.ok(script.includes('event.source === window.parent'));
});

test('the native and Electron resources exactly match the canonical exports', async () => {
  for (const filename of ['droidex-artwork.html','droidex-pairing-guide.svg']) {
    const expected = await asset(filename);
    for (const directory of ['electron/mobile/artwork','mobile/ios/DroidexApp/Resources/RemoteArtwork']) {
      assert.equal(await readFile(new URL(directory+'/'+filename,root),'utf8'),expected);
    }
  }
  assert.match(await asset('droidex-glass-morph.svg'), /<animate attributeName="d"/);
  assert.match(await asset('droidex-glass-morph.svg'), /prefers-reduced-motion/);
});

// Controlled scheduling protects interruption and teardown without timing sleeps.
function rig() {
  class Node {
    dataset = {};
    attributes = new Map();
    setAttribute(key,value) { this.attributes.set(key,value); }
    getAttribute(key) { return this.attributes.get(key); }
  }
  const svg = new Node();
  const nodes = new Map(['outer','inner','caustic','glint','phone','rear','title'].map((name)=>[name,new Node()]));
  const contents = api.phaseNames.map((phase)=>{const n=new Node();n.dataset.content=phase;n.setAttribute('opacity',phase==='intro'?'1':'0');return n;});
  const labels = api.phaseNames.map((phase)=>{const n=new Node();n.dataset.screen=phase;return n;});
  svg.querySelector = (selector) => selector==='title' ? nodes.get('title') : nodes.get(selector.match(/data-(?:morph="([^"]+)"|([^\]]+))/).slice(1).find(Boolean));
  svg.querySelectorAll = (selector) => selector==='[data-content]' ? contents : selector==='[data-screen]' ? labels : [nodes.get('caustic'),nodes.get('glint')];
  const preference = Object.assign(new EventTarget(),{matches:false});
  const document = Object.assign(new EventTarget(),{hidden:false,defaultView:{matchMedia:()=>preference}});
  const frames = new Map(); let sequence=0, cleared=false;
  const container = {ownerDocument:document,innerHTML:'',querySelector:()=>svg,replaceChildren(){cleared=true;}};
  const controller = api.mount(container,{
    requestFrame(callback){frames.set(++sequence,callback);return sequence;},
    cancelFrame(id){frames.delete(id);},
  });
  return {controller,frames,svg,nodes,document,preference,cleared:()=>cleared,
    tick(time){const work=[...frames.values()];frames.clear();for(const callback of work)callback(time);}};
}

test('interrupted morphs continue from the displayed geometry and do not restart on equal states', () => {
  const r=rig();
  r.controller.setPhase('scan');r.tick(0);r.tick(260);
  const midway=r.nodes.get('outer').getAttribute('d');
  assert.notEqual(midway,api.roundedPath(api.states.scan.shape));
  r.controller.setPhase('approval');r.tick(270);
  assert.equal(r.nodes.get('outer').getAttribute('d'),midway);
  const count=r.frames.size;r.controller.setPhase('approval');assert.equal(r.frames.size,count);
  r.tick(950);
  assert.equal(r.nodes.get('outer').getAttribute('d'),api.roundedPath(api.states.approval.shape));
  assert.equal(r.frames.size,0);
  r.controller.destroy();
});

test('reduced motion, hidden windows and destruction cancel owned animation frames', () => {
  const r=rig();
  r.controller.setPhase('running');assert.equal(r.frames.size,1);
  r.controller.setReducedMotion(true);assert.equal(r.frames.size,0);
  assert.equal(r.nodes.get('outer').getAttribute('d'),api.roundedPath(api.states.running.shape));
  r.controller.setReducedMotion(false);r.controller.setPhase('scan');
  r.document.hidden=true;r.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(r.frames.size,0);assert.equal(r.svg.dataset.active,'false');
  r.document.hidden=false;r.document.dispatchEvent(new Event('visibilitychange'));
  r.controller.setPhase('approval');r.controller.destroy();
  assert.equal(r.frames.size,0);assert.ok(r.cleared());
  r.controller.setPhase('connected');assert.equal(r.frames.size,0);
});
