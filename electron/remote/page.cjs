const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assets = Object.create(null);
for (const [route, name, mime] of [
  ['/', 'index.html', 'text/html'],
  ['/app.js', 'app.js', 'text/javascript'],
  ['/style.css', 'style.css', 'text/css'],
]) {
  assets[route] = [mime + '; charset=utf-8', readFileSync(join(__dirname, 'web', name), 'utf8')];
}
module.exports = { assets };
