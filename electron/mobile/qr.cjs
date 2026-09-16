const QRCode = require('./vendor/QRCode');
const levels = require('./vendor/QRCode/QRErrorCorrectLevel');

function pairingQrDataUrl(code) {
  if (typeof code !== 'string' || !/^DX1\.[A-Za-z0-9_-]+$/.test(code) || code.length > 2048) {
    throw new Error('Invalid DROIDEX pairing code.');
  }
  const qr = new QRCode(-1, levels.M);
  qr.addData(code);
  qr.make();
  const size = qr.getModuleCount();
  const quiet = 4;
  const cells = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.isDark(y, x)) cells.push(`M${x + quiet},${y + quiet}h1v1h-1z`);
    }
  }
  const width = size + quiet * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${width}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${cells.join('')}" fill="black"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

module.exports = { pairingQrDataUrl };
