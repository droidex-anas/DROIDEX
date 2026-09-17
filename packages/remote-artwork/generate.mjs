import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './artwork.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const api = globalThis.DroidexArtwork;
const check = process.argv.includes('--check');
const runtime = await readFile(new URL('./artwork.js',import.meta.url),'utf8');
const inner = (svg) => svg.replace(/^<svg\b[^>]*>/,'').replace(/<\/svg>$/,'');

function guide() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500" role="img" aria-labelledby="guide-title guide-desc">
  <title id="guide-title">DROIDEX Remote — Scan. Approve. Continue.</title>
  <desc id="guide-desc">An illustrated three-step pairing guide. On your computer, open Settings, then Remote, choose a project, and create a pairing QR. On your phone, choose Add computer and Scan QR code, or paste the pairing code. Approve your own phone on the desktop. Keep both devices on the same trusted network and the computer awake. The illustration contains no real pairing code or credentials.</desc>
  <metadata>Original DROIDEX vector artwork. iPhone 17 Pro outer proportions from https://support.apple.com/en-nz/125090 . Not an Apple-provided asset. Illustrative UI; never a live connection indicator.</metadata>
  <rect width="1200" height="1500" fill="#0b0c0e"/>
  <g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" fill="#eeefed">
    <text x="76" y="80" font-size="21" font-weight="650" letter-spacing="3.6">DROIDEX</text>
    <text x="1124" y="79" text-anchor="end" font-size="13" fill="#8e939a" letter-spacing="1.5">REMOTE · QUICK START</text>
    <text x="76" y="174" font-size="66" font-weight="550" letter-spacing="-2.4">Your computer.</text>
    <text x="76" y="247" font-size="66" font-weight="550" letter-spacing="-2.4">Now within reach.</text>
    <text x="79" y="300" font-size="20" fill="#949ca6">One shared project. The same agent sessions. A little more freedom.</text>
    <g transform="translate(52 333) scale(1.096)">${inner(api.renderScene('scan','guide-scene'))}</g>
    <path d="M76 1060h1048" stroke="#2a2e34"/>
    <g transform="translate(76 1110)">
      <text font-size="13" letter-spacing="1.6" fill="#8e969f">01 / COMPUTER</text>
      <text y="43" font-size="26" font-weight="550" letter-spacing="-.6">Create your QR.</text>
      <text y="81" font-size="17" fill="#a0a7b0"><tspan x="0">Open Settings → Remote.</tspan><tspan x="0" dy="27">Choose the project to share,</tspan><tspan x="0" dy="27">then Create pairing QR.</tspan></text>
    </g>
    <g transform="translate(450 1110)">
      <text font-size="13" letter-spacing="1.6" fill="#8e969f">02 / PHONE</text>
      <text y="43" font-size="26" font-weight="550" letter-spacing="-.6">Scan or paste.</text>
      <text y="81" font-size="17" fill="#a0a7b0"><tspan x="0">Tap Add computer → Scan QR.</tspan><tspan x="0" dy="27">Or Copy pairing code on desktop</tspan><tspan x="0" dy="27">and tap Paste on your phone.</tspan></text>
    </g>
    <g transform="translate(833 1110)">
      <text font-size="13" letter-spacing="1.6" fill="#8e969f">03 / CONFIRM</text>
      <text y="43" font-size="26" font-weight="550" letter-spacing="-.6">Approve. Continue.</text>
      <text y="81" font-size="17" fill="#a0a7b0"><tspan x="0">Approve your phone on desktop.</tspan><tspan x="0" dy="27">Wait for Connected, then</tspan><tspan x="0" dy="27">open a session or start one.</tspan></text>
    </g>
    <path d="M76 1336h1048" stroke="#2a2e34"/>
    <text x="76" y="1382" font-size="17" fill="#d0d5db">Same trusted network. Computer awake. DROIDEX open.</text>
    <text x="76" y="1416" font-size="14" fill="#7f8995">QR expired? Choose New code. Approve only a phone you just paired.</text>
    <text x="76" y="1442" font-size="14" fill="#7f8995">Keep real pairing codes out of screenshots. Provider credentials stay on your computer.</text>
    <text x="1124" y="1463" text-anchor="end" font-size="11" fill="#636d78">ILLUSTRATED GUIDE · NO LIVE CREDENTIALS</text>
  </g>
</svg>`;
}

// A shareable, script-free SMIL study of the same geometric glass shapes.
// Tutorial animation is explicitly separate from the state-driven app viewer.
function morph() {
  const phases = ['intro','scan','verifying','approval','syncing','connected','running','intro'];
  const paths = phases.map((phase)=>api.roundedPath(api.states[phase].shape));
  const markup = api.renderScene('intro','morph');
  const defs = markup.match(/<defs>[\s\S]*?<\/defs>/)[0];
  const times = phases.map((_,i)=>(i/(phases.length-1)).toFixed(5)).join(';');
  const splines = phases.slice(1).map(()=>'.2 .8 .2 1').join(';');
  const animation = `<animate attributeName="d" values="${paths.join(';')}" keyTimes="${times}" calcMode="spline" keySplines="${splines}" dur="18s" repeatCount="indefinite"/>`;
  const translated = `<g transform="translate(-204 -446)"><path d="${paths[0]}" fill="url(#morph-glass)" stroke="url(#morph-glass-edge)" stroke-width="2.2">${animation}</path></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="460" viewBox="0 0 960 460" role="img" aria-labelledby="m-title m-desc"><title id="m-title">DROIDEX — glass morph study</title><desc id="m-desc">Illustrative animation of capsule, scanner, approval, connected and running-panel silhouettes. This is not live connection status. A static capsule is shown with reduced motion.</desc>${defs}<style>.poster{display:none}@media(prefers-reduced-motion:reduce){.animated{display:none}.poster{display:inline}}</style><rect width="960" height="460" fill="#090a0d"/><text x="56" y="61" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="16" letter-spacing="3" fill="#edf0f5">DROIDEX</text><g transform="translate(114 80) scale(1.7)" class="animated">${translated}</g><g class="poster" transform="translate(114 80) scale(1.7)"><g transform="translate(-204 -446)"><path d="${api.roundedPath(api.states.connected.shape)}" fill="url(#morph-glass)" stroke="url(#morph-glass-edge)" stroke-width="2.2"/></g></g><text x="480" y="375" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="17" fill="#b0bbc9">Capsule → Scan → Verify → Approve → Sync → Connected → Working</text><text x="480" y="412" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12" fill="#667487">SVG GEOMETRY STUDY · ILLUSTRATION, NOT LIVE STATUS</text></svg>`;
}

function viewer(demo = false) {
  const boot = `
const morph = DroidexArtwork.mount(document.getElementById('art'), {phase:'intro'});
function update(value) {
  if (!value || !DroidexArtwork.phaseNames.includes(value.phase)) return;
  morph.setReducedMotion(value.reducedMotion === true);
  morph.setActive(value.active !== false);
  morph.setPhase(value.phase);
}
window.addEventListener('message',event => {
  if (event.source === window.parent && event.data?.type === 'droidex.artwork') update(event.data);
});
window.DroidexNativeArtwork = Object.freeze({update,destroy:()=>morph.destroy()});
window.addEventListener('pagehide',event=>{if(event.persisted)morph.setActive(false);else morph.destroy();});
window.addEventListener('pageshow',event=>{if(event.persisted)morph.setActive(!document.hidden);});
${demo ? `
const controls = document.getElementById('controls');
for (const phase of DroidexArtwork.phaseNames) {
  const button = document.createElement('button'); button.textContent = phase; button.type = 'button';
  button.addEventListener('click',()=>{morph.setPhase(phase); for(const child of controls.children) child.setAttribute('aria-pressed',String(child===button));});
  button.setAttribute('aria-pressed',String(phase==='intro')); controls.append(button);
}
document.getElementById('reduce').addEventListener('change',event=>morph.setReducedMotion(event.target.checked));
` : ''}`;
  const script = runtime + '\n' + boot;
  const hash = createHash('sha256').update(script).digest('base64');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>DROIDEX Remote artwork${demo?' — preview':''}</title><style>html,body{margin:0;width:100%;height:100%;overflow:${demo?'auto':'hidden'};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:${demo?'#0b0c0e':'transparent'};color:#edf0f5}*{box-sizing:border-box}#art{width:100%;height:${demo?'min(70vh,660px)':'100%'};pointer-events:none;user-select:none}#art>svg{display:block;width:100%;height:100%}header,footer,#controls{max-width:1000px;margin:auto;padding:20px 28px}header{font-size:14px;letter-spacing:2px}header p,footer{font-size:13px;letter-spacing:0;color:#a1abb8}#controls{display:flex;gap:8px;flex-wrap:wrap}button{border:1px solid #333b48;border-radius:12px;padding:12px 16px;background:#151b24;color:#dce5f0;cursor:pointer}button[aria-pressed=true]{background:#e4e8ee;color:#101823}button:focus-visible,a:focus-visible{outline:2px solid #e8efff;outline-offset:4px}a{color:inherit;margin-right:20px}label{margin-right:20px}input{accent-color:#fff}</style></head><body>${demo?'<header>DROIDEX / REMOTE ARTWORK<p>Interactive illustration preview. These controls do not connect to a computer.</p></header>':''}<div id="art"${demo?'':' aria-hidden="true"'}>${api.renderScene('intro','poster')}</div>${demo?'<div id="controls" aria-label="Illustration phase"></div><footer><label><input id="reduce" type="checkbox"> Reduce motion</label><a href="droidex-pairing-guide.svg" download>Download SVG guide</a><a href="iphone17-pro.svg" download>Device SVG</a><a href="droidex-glass-morph.svg" download>Animated SVG</a></footer>':''}<script>${script}</script></body></html>`;
}

const files = {
  'droidex-artwork.html': viewer(),
  'droidex-pairing-guide.svg': guide(),
  'iphone17-pro.svg': api.renderDevice(),
  'droidex-glass-morph.svg': morph(),
  'index.html': viewer(true),
};
const destinations = [
  ['public/remote-artwork',Object.keys(files)],
  ['electron/mobile/artwork',['droidex-artwork.html','droidex-pairing-guide.svg']],
  ['mobile/ios/DroidexApp/Resources/RemoteArtwork',['droidex-artwork.html','droidex-pairing-guide.svg']],
];
let stale = false;
for (const [folder,names] of destinations) for (const name of names) {
  const destination = resolve(root,folder,name), expected = files[name]+'\n';
  if (check) {
    let actual; try { actual = await readFile(destination,'utf8'); } catch { actual = undefined; }
    if (actual !== expected) { console.error('Regenerate:',folder+'/'+name); stale = true; }
  } else { await mkdir(dirname(destination),{recursive:true}); await writeFile(destination,expected); }
}
if (stale) process.exitCode = 1;
else console.log(check?'Remote artwork assets are current.':'Generated remote SVG artwork and offline viewers.');
