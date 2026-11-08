// Minimal Apps Script runtime simulator (Sheets, Lock, Properties, Utilities, Content/Html) for local tests.
const crypto = require('crypto'), vm = require('vm'), fs = require('fs'), path = require('path');

function makeRuntime(opts = {}) {
  const sheets = {}; const props = Object.assign({}, opts.props || {});
  let nowMs = opts.now || Date.UTC(2026, 10, 8, 10, 0, 0);
  const strictDates = (v, fmt) => (fmt !== '@' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(v)) ? new Date(v.replace(' ', 'T') + 'Z') : v;

  class Sheet {
    constructor(name) { this.name = name; this.maxRows = 1000; this.cells = {}; this.fmt = {}; this.last = 0; }
    getMaxRows() { return this.maxRows; }
    getLastRow() { return this.last; }
    insertRowsAfter(r, n) { this.maxRows += n; }
    setFrozenRows() {}
    deleteRow(r) {
      const nc = {}, nf = {};
      Object.keys(this.cells).forEach(k => { const [rr, cc] = k.split(',').map(Number); if (rr < r) nc[k] = this.cells[k]; else if (rr > r) nc[(rr - 1) + ',' + cc] = this.cells[k]; });
      Object.keys(this.fmt).forEach(k => { const [rr, cc] = k.split(',').map(Number); if (rr < r) nf[k] = this.fmt[k]; else if (rr > r) nf[(rr - 1) + ',' + cc] = this.fmt[k]; });
      this.cells = nc; this.fmt = nf; this.last = Math.max(0, this.last - 1); this.maxRows--;
    }
    getRange(r, c, nr = 1, nc = 1) {
      const sh = this;
      if (r < 1 || c < 1 || r + nr - 1 > sh.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      const rng = {
        setValues(vals) {
          if (vals.length !== nr || vals[0].length !== nc) throw new Error('Dimension mismatch');
          vals.forEach((row, i) => row.forEach((v, j) => { const k = (r + i) + ',' + (c + j); sh.cells[k] = strictDates(v, sh.fmt[k]); if (r + i > sh.last) sh.last = r + i; }));
          return rng;
        },
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = sh.cells[(r + i) + ',' + (c + j)]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
        setNumberFormat(f) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.fmt[(r + i) + ',' + (c + j)] = f; return rng; },
        setFontWeight() { return rng; }
      };
      return rng;
    }
  }
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)) };

  let locked = false;
  const ctx = {
    console, JSON, Math, Date, Number, String, Object, Array, isFinite, isNaN, parseInt, parseFloat, Error, RegExp,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] === undefined ? null : props[k], setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() { if (locked) throw new Error('Could not obtain lock'); locked = true; }, releaseLock() { locked = false; } }) },
    Session: { getScriptTimeZone: () => 'Africa/Accra' },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, f) => { const p = n => String(n).padStart(2, '0'); const s = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`; return f.indexOf('HH') !== -1 ? `${s} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` : s; }
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; }, getContent() { return t; } }) },
    HtmlService: { XFrameOptionsMode: { DEFAULT: 1 }, createHtmlOutputFromFile: n => { const o = { name: n, setTitle() { return o; }, addMetaTag() { return o; }, setXFrameOptionsMode() { return o; } }; return o; } }
  };
  ctx.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super(nowMs); } static now() { return nowMs; } };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'gas');
  ['Db', 'Auth', 'Services', 'Restaurant', 'Setup', 'Code'].forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f + '.gs'), 'utf8'), ctx, { filename: f + '.gs' }));
  return { ctx, sheets, props, setNow: ms => { nowMs = ms; }, advanceDays: d => { nowMs += d * 86400000; },
    call(action, token, args) { return JSON.parse(JSON.stringify(vm.runInContext('rpc', ctx)(JSON.stringify({ action, token, args })))); } };
}
module.exports = { makeRuntime };
