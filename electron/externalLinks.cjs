const { shell } = require('electron');

function openExternal(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('Refusing to open non-http(s) URL.');
  }
  return shell.openExternal(url);
}

module.exports = { openExternal };
