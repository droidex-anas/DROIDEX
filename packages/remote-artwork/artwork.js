/* Original DROIDEX artwork. Device proportions: device.json. No external assets. */
(() => {
  'use strict';
  const states = Object.freeze({
    intro:     { label: 'Your computer, within reach', shape: [430, 524, 46, 82, 23], phone: [535, 38, .72, -6], rear: .85, panel: 0 },
    scan:      { label: 'Scan the QR on your computer', shape: [355, 460, 134, 134, 39], phone: [544, 40, .72, 0], rear: .2, panel: 1 },
    verifying: { label: 'Checking the connection', shape: [300, 502, 288, 80, 40], phone: [544, 40, .72, 0], rear: .1, panel: 2 },
    approval:  { label: 'Approve on your computer', shape: [278, 494, 330, 90, 38], phone: [566, 65, .66, 3], rear: .1, panel: 3 },
    syncing:   { label: 'Loading your workspace', shape: [286, 492, 314, 98, 36], phone: [544, 40, .72, 0], rear: .1, panel: 4 },
    connected: { label: 'Connected to your computer', shape: [306, 507, 282, 70, 35], phone: [544, 40, .72, 0], rear: .1, panel: 5 },
    running:   { label: 'Your agent is working', shape: [263, 482, 366, 114, 37], phone: [544, 40, .72, 0], rear: .1, panel: 6 },
    offline:   { label: 'The computer is offline', shape: [298, 503, 298, 78, 39], phone: [544, 40, .72, 0], rear: .1, panel: 7 },
    error:     { label: 'Check the connection', shape: [296, 498, 302, 86, 36], phone: [544, 40, .72, 0], rear: .1, panel: 8 },
  });
  const phaseNames = Object.freeze(Object.keys(states));
  const valid = (phase) => Object.hasOwn(states, phase) ? phase : 'intro';
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c]));
  const scope = (value) => /^[a-z][a-z0-9-]*$/i.test(value) ? value : 'dx';
  const round = (value) => Number(value.toFixed(3));

  // All keyframes retain the same cubic topology, including circles and capsules.
  function roundedPath([x, y, width, height, radius]) {
    const r = Math.min(radius, width / 2, height / 2), k = .55228475;
    return `M${round(x+r)} ${round(y)} L${round(x+width-r)} ${round(y)} C${round(x+width-r+r*k)} ${round(y)} ${round(x+width)} ${round(y+r-r*k)} ${round(x+width)} ${round(y+r)} L${round(x+width)} ${round(y+height-r)} C${round(x+width)} ${round(y+height-r+r*k)} ${round(x+width-r+r*k)} ${round(y+height)} ${round(x+width-r)} ${round(y+height)} L${round(x+r)} ${round(y+height)} C${round(x+r-r*k)} ${round(y+height)} ${round(x)} ${round(y+height-r+r*k)} ${round(x)} ${round(y+height-r)} L${round(x)} ${round(y+r)} C${round(x)} ${round(y+r-r*k)} ${round(x+r-r*k)} ${round(y)} ${round(x+r)} ${round(y)} Z`;
  }
  function definitions(p) {
    return `<defs>
      <linearGradient id="${p}-metal" x1="0" y1="0" x2="1" y2=".16"><stop stop-color="#33353a"/><stop offset=".018" stop-color="#dadbdc"/><stop offset=".035" stop-color="#8d8f93"/><stop offset=".09" stop-color="#f3f3f1"/><stop offset=".45" stop-color="#b7b8bc"/><stop offset=".78" stop-color="#f9faf8"/><stop offset=".96" stop-color="#979a9e"/><stop offset="1" stop-color="#36383d"/></linearGradient>
      <linearGradient id="${p}-edge" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#fcfdfa"/><stop offset=".2" stop-color="#aaadb2"/><stop offset=".5" stop-color="#3e4148"/><stop offset=".81" stop-color="#9ea0a5"/><stop offset="1" stop-color="#e6e8e7"/></linearGradient>
      <linearGradient id="${p}-rear" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#eeefed"/><stop offset=".55" stop-color="#c1c4c5"/><stop offset="1" stop-color="#9da1a6"/></linearGradient>
      <linearGradient id="${p}-ceramic" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f0f1ef"/><stop offset=".6" stop-color="#dce0df"/><stop offset="1" stop-color="#c7cccd"/></linearGradient>
      <linearGradient id="${p}-bezel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#08090c"/><stop offset=".45" stop-color="#22252a"/><stop offset="1" stop-color="#030405"/></linearGradient>
      <linearGradient id="${p}-reflection" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".18"/><stop offset=".48" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".015"/></linearGradient>
      <radialGradient id="${p}-lens"><stop stop-color="#0b1521"/><stop offset=".31" stop-color="#1b2640"/><stop offset=".44" stop-color="#091018"/><stop offset=".7" stop-color="#1c2027"/><stop offset=".85" stop-color="#030406"/><stop offset="1" stop-color="#2e3339"/></radialGradient>
      <linearGradient id="${p}-glass" x1="0" y1="0" x2=".6" y2="1"><stop stop-color="#454d5a"/><stop offset=".05" stop-color="#232831"/><stop offset=".3" stop-color="#0d1118"/><stop offset=".76" stop-color="#0b0e14"/><stop offset="1" stop-color="#27364a"/></linearGradient>
      <linearGradient id="${p}-glass-edge" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="#f6f8ff"/><stop offset=".21" stop-color="#a3aebe"/><stop offset=".46" stop-color="#202a39"/><stop offset=".72" stop-color="#53677e"/><stop offset="1" stop-color="#b9d4ef"/></linearGradient>
      <linearGradient id="${p}-glass-inner" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fcfcff" stop-opacity=".7"/><stop offset=".3" stop-color="#dce7fa" stop-opacity=".02"/><stop offset=".75" stop-color="#dce7fa" stop-opacity=".01"/><stop offset="1" stop-color="#a6d5fa" stop-opacity=".6"/></linearGradient>
      <radialGradient id="${p}-caustic" cx=".84" cy="1.04" r=".75"><stop stop-color="#bee4ff" stop-opacity=".26"/><stop offset=".32" stop-color="#6e9ac5" stop-opacity=".11"/><stop offset=".73" stop-color="#2b4a68" stop-opacity="0"/></radialGradient>
      <radialGradient id="${p}-glint" cx=".04" cy=".02" r=".72"><stop stop-color="#f5f8ff" stop-opacity=".46"/><stop offset=".17" stop-color="#bcc9e1" stop-opacity=".13"/><stop offset=".58" stop-color="#9cb4d0" stop-opacity="0"/></radialGradient>
      <radialGradient id="${p}-orb" cx=".28" cy=".2" r=".85"><stop stop-color="#d5dfed" stop-opacity=".85"/><stop offset=".2" stop-color="#4e6078"/><stop offset=".67" stop-color="#141d2b"/><stop offset="1" stop-color="#586e87"/></radialGradient>
      <radialGradient id="${p}-shadow"><stop stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <clipPath id="${p}-screen"><rect x="13.25" y="12.6" width="333" height="724.8" rx="46"/></clipPath>
      <filter id="${p}-lift" x="-30%" y="-30%" width="160%" height="175%"><feDropShadow dx="0" dy="10" stdDeviation="13" flood-color="#000" flood-opacity=".24"/></filter>
    </defs>`;
  }
  function deviceBody(p, back = false) {
    const lens = (cx, cy) => `<g transform="translate(${cx} ${cy})"><circle r="46" fill="url(#${p}-edge)"/><circle r="43.5" fill="#20242a" stroke="#fafaf7" stroke-opacity=".55" stroke-width="1.3"/><circle r="40.5" fill="#05070a"/><circle r="34" fill="url(#${p}-lens)"/><circle r="21" fill="none" stroke="#4c5366" stroke-opacity=".48"/><circle r="13" fill="#040913"/><ellipse cx="-11" cy="-14" rx="8" ry="5" fill="#728eb8" opacity=".3"/><circle cx="9" cy="9" r="4.8" fill="#30556d" opacity=".55"/></g>`;
    return `<g data-device-face="${back ? 'rear' : 'front'}">
      <rect x="-3" y="126" width="6" height="31" rx="2.8" fill="url(#${p}-edge)"/>
      <rect x="-3.7" y="203" width="6" height="55" rx="2.8" fill="url(#${p}-edge)"/>
      <rect x="-3.7" y="274" width="6" height="55" rx="2.8" fill="url(#${p}-edge)"/>
      <rect x="357" y="210" width="6" height="84" rx="3" fill="url(#${p}-edge)"/>
      <rect x="358" y="465" width="5" height="64" rx="2.5" fill="url(#${p}-metal)"/>
      <rect width="359.5" height="750" rx="58" fill="url(#${p}-metal)" stroke="#606269" stroke-width=".8"/>
      <rect x="3" y="3" width="353.5" height="744" rx="55" fill="${back ? `url(#${p}-rear)` : `url(#${p}-bezel)`}" stroke="url(#${p}-edge)" stroke-width="1.5"/>
      <path d="M2 92h5M353 92h5M2 656h5M353 656h5" stroke="#72767c" stroke-width="4" opacity=".75"/>
      ${back ? `<rect x="11" y="12" width="337.5" height="214" rx="48" fill="url(#${p}-rear)" stroke="#fff" stroke-opacity=".6" filter="url(#${p}-lift)"/>
        <rect x="17" y="252" width="325.5" height="478" rx="42" fill="url(#${p}-ceramic)" stroke="#fff" stroke-opacity=".55"/>
        ${lens(79, 70)}${lens(79, 169)}${lens(178, 119)}
        <circle cx="297" cy="67" r="15" fill="#c5c9c8" stroke="#f6f6ed" stroke-width="3"/>
        <circle cx="297" cy="67" r="9" fill="#eff0dc"/>
        <circle cx="297" cy="170" r="17" fill="#252a2c" stroke="#e4e8e6" stroke-opacity=".6"/>
        <circle cx="298" cy="119" r="2.3" fill="#565b5e"/>`
      : `<rect x="10.5" y="10" width="338.5" height="730" rx="48" fill="#030405" stroke="#454b53" stroke-width=".8"/>
        <rect x="13.25" y="12.6" width="333" height="724.8" rx="46" fill="#0e1013"/>
        <path d="M55 14h250" stroke="#fff" stroke-opacity=".17" stroke-width="1"/>
        <rect x="128" y="27" width="103.5" height="30.5" rx="15.25" fill="#000"/>
        <circle cx="215" cy="42.25" r="8.5" fill="#070b13"/><circle cx="215" cy="42.25" r="4.8" fill="#111a2b"/><circle cx="213.5" cy="40.5" r="1.8" fill="#415477" opacity=".5"/>
        <rect x="136" y="727" width="87.5" height="4.2" rx="2.1" fill="#f3f4f2" opacity=".6"/>`}
    </g>`;
  }
  function phoneScreen(p, phase) {
    const labels = ['Keep your workspace close', 'Scan the desktop QR', 'Checking your computer', 'Approve on your computer', 'Loading your workspace', 'Your workspace is ready', 'Your agent is working', 'Computer offline', 'Check your connection'];
    const order = phaseNames.indexOf(phase);
    const rows = [0,1,2].map((i) => `<g transform="translate(37 ${229+i*81})"><rect width="284" height="62" rx="13" fill="#171a1f" stroke="#272c33"/><rect x="15" y="17" width="${164-i*22}" height="5" rx="2.5" fill="#7b8089" opacity=".65"/><rect x="15" y="34" width="${102+i*11}" height="4" rx="2" fill="#444b56"/><circle cx="260" cy="30" r="3" fill="#818b97"/></g>`).join('');
    return `<g clip-path="url(#${p}-screen)" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">
      <text x="38" y="106" font-size="12" font-weight="650" letter-spacing="2.2" fill="#eeefed">DROIDEX</text>
      <text x="38" y="150" font-size="26" font-weight="580" letter-spacing="-.6" fill="#f5f6f4">Remote</text>
      <g data-screen-labels>${labels.map((label,i)=>`<text data-screen="${phaseNames[i]}" x="38" y="178" font-size="12.5" fill="#959da8" opacity="${i===order?1:0}">${label}</text>`).join('')}</g>
      ${rows}
      <path d="M38 507h284" stroke="#252a32"/>
      <text x="38" y="537" font-size="12" fill="#7e8794">Your computer runs the agents.</text>
      <text x="38" y="557" font-size="12" fill="#7e8794">Your credentials stay there.</text>
      <rect x="37" y="627" width="285" height="48" rx="24" fill="#1f242b" stroke="#343b46"/>
      <text x="59" y="657" font-size="13" fill="#b6bdc7">Plan, ask, build…</text>
      <rect x="13.25" y="12.6" width="333" height="724.8" rx="46" fill="url(#${p}-reflection)" pointer-events="none"/>
    </g>`;
  }
  function desktop(p) {
    return `<g data-desktop="true" transform="translate(47 193)">
      <rect x="0" y="0" width="472" height="291" rx="17" fill="url(#${p}-metal)" stroke="#a9adb4" stroke-width=".6"/>
      <rect x="3" y="3" width="466" height="285" rx="15" fill="#0d0f12"/>
      <rect x="11" y="11" width="450" height="269" rx="9" fill="#16191e"/>
      <path d="M12 45h448M110 46v233" stroke="#2d323a"/>
      <text x="27" y="32" font-size="10" letter-spacing="1.7" fill="#e4e7eb">DROIDEX</text>
      <text x="27" y="79" font-size="10" fill="#868e99">Settings</text>
      <rect x="20" y="96" width="80" height="25" rx="7" fill="#2b3038"/>
      <text x="29" y="112" font-size="10" fill="#f5f6f7">Remote</text>
      <text x="137" y="86" font-size="19" font-weight="560" letter-spacing="-.5" fill="#f3f5f7">Connect your phone.</text>
      <text x="137" y="108" font-size="10" fill="#929ba7">Same network. One shared project.</text>
      <rect x="137" y="128" width="106" height="106" rx="14" fill="#ecefeb"/>
      <path d="M152 162v-17h17M211 145h17v17M228 200v18h-17M169 218h-17v-18" fill="none" stroke="#1a2027" stroke-width="4" stroke-linecap="round"/>
      <text x="190" y="184" text-anchor="middle" font-size="12" font-weight="600" fill="#27313c">YOUR QR</text>
      <text x="265" y="151" font-size="12" font-weight="560" fill="#e3e8ed">Scan on your phone.</text>
      <text x="265" y="174" font-size="10" fill="#929ba7">Approve on this computer.</text>
      <rect x="264" y="197" width="163" height="31" rx="8" fill="#e5e8ea"/>
      <text x="345.5" y="216" text-anchor="middle" font-size="10" fill="#161a20">Copy pairing code</text>
      <path d="M-22 291h516l-18 16a15 15 0 0 1-10 4H6a15 15 0 0 1-10-4Z" fill="url(#${p}-edge)"/>
      <path d="M177 291h120l-4 6H181Z" fill="#767c85"/>
    </g>`;
  }
  function glassContents() {
    const groups = [
      `<path d="M411 488h-16v16M449 488h16v16M465 540v16h-16M411 556h-16v-16" fill="none" stroke="#e4edf5" stroke-width="3" stroke-linecap="round"/><path class="dx-scan" d="M395 518h70" stroke="#d4e3f3" stroke-width="1.4"/>`,
      `<circle class="dx-pulse" cx="327" cy="542" r="4" fill="#dfe7f2"/><text x="348" y="547">Checking connection</text>`,
      `<text x="312" y="533">Approve on desktop</text><text x="312" y="554" class="dx-secondary">Only the phone you just scanned with.</text>`,
      `<path class="dx-flow" d="M315 541h35" stroke="#dce7f5" stroke-width="2" stroke-dasharray="8 5"/><text x="365" y="546">Loading workspace</text>`,
      `<circle cx="332" cy="542" r="8" fill="#a5c0d6" fill-opacity=".17" stroke="#abc4d9" stroke-opacity=".55"/><path d="m328 542 3 3 5-6" fill="none" stroke="#eaf3fa" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><text x="355" y="547">Connected</text>`,
      `<circle class="dx-pulse" cx="301" cy="526" r="5" fill="#e5eef9"/><text x="322" y="532">Agent working</text><text x="291" y="558" class="dx-secondary">Follow the work from either device.</text><path class="dx-flow" d="M291 577h280" stroke="#bdcfe5" stroke-opacity=".55" stroke-width="1.6" stroke-dasharray="42 16"/>`,
      `<text x="331" y="546">Computer offline</text>`,
      `<text x="329" y="538">Check connection</text><text x="329" y="558" class="dx-secondary">Return to the controls below.</text>`,
    ];
    return ['scan','verifying','approval','syncing','connected','running','offline','error'].map((phase,i)=>`<g data-content="${phase}" opacity="0">${groups[i]}</g>`).join('');
  }
  function style() {
    return `<style>
      .dx-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#edeff2}
      .dx-glass-label{font-size:16px;font-weight:530;fill:#edf2f8;letter-spacing:-.15px}
      .dx-secondary{font-size:10.5px;fill:#96a5b7;font-weight:400;letter-spacing:0}
      .dx-pulse{transform-box:fill-box;transform-origin:center}
      [data-phase="verifying"] [data-content="verifying"] .dx-pulse,[data-phase="running"] [data-content="running"] .dx-pulse{animation:dx-breathe 1.6s ease-in-out infinite}
      [data-phase="running"] [data-content="running"] .dx-flow,[data-phase="syncing"] [data-content="syncing"] .dx-flow{animation:dx-flow 1.3s linear infinite}
      [data-phase="scan"] [data-content="scan"] .dx-scan{animation:dx-scan 2s ease-in-out infinite}
      @keyframes dx-breathe{50%{opacity:.4;transform:scale(.8)}}
      @keyframes dx-flow{to{stroke-dashoffset:-58}}
      @keyframes dx-scan{0%,100%{transform:translateY(-16px);opacity:.4}50%{transform:translateY(22px);opacity:1}}
      .dx-root[data-active="false"] *,.dx-root[data-reduced="true"] *{animation:none!important}
      @media(prefers-reduced-motion:reduce){.dx-root *{animation:none!important}}
    </style>`;
  }
  function renderScene(phase = 'intro', prefix = 'dx') {
    phase = valid(phase); const p = scope(prefix), current = states[phase];
    return `<svg xmlns="http://www.w3.org/2000/svg" class="dx-root" viewBox="0 0 1000 660" role="img" aria-labelledby="${p}-title ${p}-desc" data-phase="${phase}" data-active="false">
      <title id="${p}-title">${escape(current.label)}</title><desc id="${p}-desc">Original iPhone 17 Pro-proportioned vector illustration with a desktop and a morphing glass status panel. The illustration does not contain a working pairing QR.</desc>
      ${style()}${definitions(p)}
      <ellipse cx="479" cy="602" rx="395" ry="35" fill="url(#${p}-shadow)"/>
      ${desktop(p)}
      <g data-rear="true" opacity="${current.rear}" transform="translate(714 121) scale(.56) rotate(9 180 375)">${deviceBody(p,true)}</g>
      <g data-phone="true" transform="translate(${current.phone[0]} ${current.phone[1]}) scale(${current.phone[2]}) rotate(${current.phone[3]} 180 375)">
        ${deviceBody(p)}${phoneScreen(p, phase)}
      </g>
      <g data-glass="true" filter="url(#${p}-lift)">
        <path data-morph="outer" d="${roundedPath(current.shape)}" fill="url(#${p}-glass)" stroke="url(#${p}-glass-edge)" stroke-width="2.2"/>
        <path data-morph="caustic" d="${roundedPath(current.shape)}" fill="url(#${p}-caustic)"/>
        <path data-morph="glint" d="${roundedPath(current.shape)}" fill="url(#${p}-glint)"/>
        <path data-morph="inner" d="${roundedPath(inset(current.shape,3))}" fill="none" stroke="url(#${p}-glass-inner)" stroke-width="1.1"/>
      </g>
      <g data-content="intro" opacity="${phase==='intro'?1:0}"><ellipse cx="451" cy="550" rx="11" ry="16" fill="url(#${p}-orb)"/></g>
      <g class="dx-glass-label">${glassContents().replace(`data-content="${phase}" opacity="0"`, `data-content="${phase}" opacity="1"`)}</g>
    </svg>`;
  }
  function inset(box, by) { return [box[0]+by,box[1]+by,box[2]-by*2,box[3]-by*2,Math.max(0,box[4]-by)]; }
  function renderDevice(prefix = 'device') {
    const p = scope(prefix);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 840" role="img" aria-labelledby="${p}-title ${p}-desc"><title id="${p}-title">iPhone 17 Pro-style silver vector mockup</title><desc id="${p}-desc">Original front and rear vector reconstruction. The body width-to-height ratio is 71.9 to 150. Not an official Apple asset; optical details and radii are illustrative.</desc>${definitions(p)}<ellipse cx="436" cy="804" rx="400" ry="29" fill="url(#${p}-shadow)"/><g transform="translate(37 34)">${deviceBody(p,true)}</g><g transform="translate(466 34)">${deviceBody(p)}${phoneScreen(p,'intro')}</g></svg>`;
  }

  function mount(container, options = {}) {
    const doc = container.ownerDocument, view = doc.defaultView;
    let phase = valid(options.phase), active = options.active !== false;
    let reduced = options.reducedMotion === true, disposed = false, frame = null;
    let target = states[phase], rendered = { shape: [...target.shape], phone: [...target.phone], rear: target.rear };
    const prefix = scope(options.prefix || 'live');
    container.innerHTML = renderScene(phase,prefix);
    const svg = container.querySelector('svg'), outer = svg.querySelector('[data-morph="outer"]');
    const caustics = [...svg.querySelectorAll('[data-morph="caustic"], [data-morph="glint"]')];
    const inner = svg.querySelector('[data-morph="inner"]'), phone = svg.querySelector('[data-phone]'), rear = svg.querySelector('[data-rear]');
    const contents = [...svg.querySelectorAll('[data-content]')], labels = [...svg.querySelectorAll('[data-screen]')];
    const requestFrame = options.requestFrame || ((fn) => view.requestAnimationFrame(fn));
    const cancelFrame = options.cancelFrame || ((id) => view.cancelAnimationFrame(id));
    const preference = view.matchMedia('(prefers-reduced-motion: reduce)');
    const opacity = new Map(contents.map((node) => [node,Number(node.getAttribute('opacity'))]));
    const canAnimate = () => active && !doc.hidden && !reduced && !preference.matches;
    const stop = () => { if (frame !== null) cancelFrame(frame); frame = null; };
    function paint(value) {
      rendered = value;
      outer.setAttribute('d',roundedPath(value.shape));
      for (const layer of caustics) layer.setAttribute('d',roundedPath(value.shape));
      inner.setAttribute('d',roundedPath(inset(value.shape,3)));
      phone.setAttribute('transform',`translate(${round(value.phone[0])} ${round(value.phone[1])}) scale(${round(value.phone[2])}) rotate(${round(value.phone[3])} 180 375)`);
      rear.setAttribute('opacity',String(round(value.rear)));
    }
    function finish() {
      paint({shape:[...target.shape],phone:[...target.phone],rear:target.rear});
      for (const node of contents) { const alpha = node.dataset.content === phase ? 1 : 0; opacity.set(node,alpha); node.setAttribute('opacity',String(alpha)); }
    }
    function settleVisibility() {
      svg.dataset.active = String(active && !doc.hidden);
      svg.dataset.reduced = String(reduced || preference.matches);
      if (!canAnimate()) { stop(); finish(); }
    }
    function setPhase(next) {
      if (disposed) return;
      next = valid(next);
      if (next === phase) return;
      stop(); phase = next; target = states[phase]; svg.dataset.phase = phase;
      svg.querySelector('title').textContent = target.label;
      for (const node of labels) node.setAttribute('opacity',node.dataset.screen === phase ? '1' : '0');
      if (!canAnimate()) { finish(); return; }
      const start = { shape:[...rendered.shape],phone:[...rendered.phone],rear:rendered.rear };
      const startOpacity = new Map(opacity); let startTime;
      const mix = (a,b,t) => a+(b-a)*t;
      const step = (time) => {
        if (disposed || !canAnimate()) return;
        startTime ??= time;
        const progress = Math.min(1,(time-startTime)/640), ease = 1-Math.pow(1-progress,4);
        paint({ shape:start.shape.map((n,i)=>mix(n,target.shape[i],ease)),phone:start.phone.map((n,i)=>mix(n,target.phone[i],ease)),rear:mix(start.rear,target.rear,ease) });
        for (const node of contents) {
          const alpha = mix(startOpacity.get(node),node.dataset.content===phase?1:0,Math.min(1,progress*1.55));
          opacity.set(node,alpha); node.setAttribute('opacity',String(round(alpha)));
        }
        if (progress < 1) frame = requestFrame(step); else { frame = null; finish(); }
      };
      frame = requestFrame(step);
    }
    const preferenceChanged = () => settleVisibility();
    const visibilityChanged = () => settleVisibility();
    preference.addEventListener('change',preferenceChanged);
    doc.addEventListener('visibilitychange',visibilityChanged);
    settleVisibility();
    return Object.freeze({
      setPhase,
      setActive(value) { if (!disposed) { active = value === true; settleVisibility(); } },
      setReducedMotion(value) { if (!disposed) { reduced = value === true; settleVisibility(); } },
      destroy() {
        if (disposed) return;
        disposed = true; stop(); preference.removeEventListener('change',preferenceChanged);
        doc.removeEventListener('visibilitychange',visibilityChanged); container.replaceChildren();
      },
    });
  }
  globalThis.DroidexArtwork = Object.freeze({phaseNames,states,roundedPath,renderScene,renderDevice,mount});
})();
