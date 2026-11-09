/* api.js - one call() for both hosts (google.script.run inside Apps Script, fetch() from GitHub Pages),
 * plus: a local copy of every screen you have opened (works offline), a queue for the work that is safe to do offline,
 * automatic retry/sync, and request de-duplication. Nothing here changes what the server decides: queued work is replayed
 * through the normal server rules and anything the server refuses is kept for you to review, never silently dropped. */
(function () {
  var IN_GAS = typeof google !== 'undefined' && google.script && google.script.run;
  var mem = {};
  function store(kind) {
    return {
      get: function (k) { try { return window[kind].getItem(k) || mem[kind + k] || ''; } catch (e) { return mem[kind + k] || ''; } },
      set: function (k, v) { mem[kind + k] = v; try { window[kind].setItem(k, v); } catch (e) {} },
      del: function (k) { delete mem[kind + k]; try { window[kind].removeItem(k); } catch (e) {} }
    };
  }
  var session = store('sessionStorage'), local = store('localStorage');
  function endpoint() { return (window.SMARTGUEST_CONFIG && window.SMARTGUEST_CONFIG.WEB_APP_URL) || local.get('sg_url'); }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2); }
  function clone(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---------- local database (IndexedDB; plain memory if the browser blocks it) ----------
  var memKV = {}, memOut = [], memSeq = 0, dbp = null;
  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      try {
        var rq = indexedDB.open('smartguest', 1);
        rq.onupgradeneeded = function () { var d = rq.result; d.createObjectStore('kv'); d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true }); };
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = rq.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  function run(store, mode, fn) {
    return openDb().then(function (db) {
      if (!db) return undefined;
      return new Promise(function (resolve) {
        try { var t = db.transaction(store, mode), rq = fn(t.objectStore(store)); t.oncomplete = function () { resolve(rq ? rq.result : undefined); }; t.onerror = t.onabort = function () { resolve(undefined); }; }
        catch (e) { resolve(undefined); }
      });
    });
  }
  function hasDb() { return openDb().then(function (d) { return !!d; }); }
  var kv = {
    get: function (k) { return hasDb().then(function (ok) { return ok ? run('kv', 'readonly', function (s) { return s.get(k); }) : memKV[k]; }); },
    set: function (k, v) { return hasDb().then(function (ok) { if (!ok) { memKV[k] = v; return; } return run('kv', 'readwrite', function (s) { return s.put(v, k); }); }); },
    keys: function () { return hasDb().then(function (ok) { return ok ? run('kv', 'readonly', function (s) { return s.getAllKeys(); }) : Object.keys(memKV); }); },
    del: function (k) { return hasDb().then(function (ok) { if (!ok) { delete memKV[k]; return; } return run('kv', 'readwrite', function (s) { return s.delete(k); }); }); }
  };
  var outbox = {
    all: function () { return hasDb().then(function (ok) { return ok ? run('outbox', 'readonly', function (s) { return s.getAll(); }) : memOut.slice(); }).then(function (a) { return a || []; }); },
    add: function (rec) { return hasDb().then(function (ok) { if (!ok) { rec.seq = ++memSeq; memOut.push(rec); return rec; } return run('outbox', 'readwrite', function (s) { return s.add(rec); }).then(function (seq) { rec.seq = seq; return rec; }); }); },
    put: function (rec) { return hasDb().then(function (ok) { if (!ok) { memOut = memOut.map(function (x) { return x.seq === rec.seq ? rec : x; }); return; } return run('outbox', 'readwrite', function (s) { return s.put(rec); }); }); },
    del: function (seq) { return hasDb().then(function (ok) { if (!ok) { memOut = memOut.filter(function (x) { return x.seq !== seq; }); return; } return run('outbox', 'readwrite', function (s) { return s.delete(seq); }); }); }
  };

  // ---------- state ----------
  var state = { online: typeof navigator === 'undefined' || navigator.onLine !== false, syncing: false, stale: 0 };
  var listeners = [], pending = [], WRITES = {}, memCache = {}, inflight = {}, MEM_TTL = 15000;
  var QUEUEABLE = { 'payments.receive': 1, 'folio.addCharge': 1, 'housekeeping.setStatus': 1, 'expenses.create': 1, 'inventory.move': 1, 'outlet.sell': 1 };
  function emit(type) { var snap = API.status(); listeners.slice().forEach(function (f) { try { f(snap, type); } catch (e) {} }); }
  function setOnline(v) { if (state.online !== v) { state.online = v; emit(v ? 'online' : 'offline'); } }
  function user() { return local.get('sg_user'); }

  // ---------- transport ----------
  function send(body) {
    if (IN_GAS) {
      return new Promise(function (resolve, reject) {
        google.script.run.withSuccessHandler(resolve).withFailureHandler(function (e) { var m = e && e.message ? e.message : 'Server error.'; var er = new Error(m); er.net = /network|offline|timed? ?out|unavailable|failed to fetch/i.test(m); reject(er); }).rpc(body);
      });
    }
    var url = endpoint();
    if (!url) return Promise.reject(new Error('NO_URL'));
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, 70000) : null;
    // text/plain keeps this a "simple" CORS request, so the browser sends no preflight (Apps Script cannot answer one).
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (timer) clearTimeout(timer); if (!r.ok) { var e = new Error('Server returned ' + r.status); e.net = r.status >= 500 || r.status === 429; throw e; } return r.text(); })
      .then(function (t) { try { return JSON.parse(t); } catch (x) { throw new Error('The server did not return data. Check that the Web App is deployed for "Anyone" and the URL is correct.'); } })
      .catch(function (e) { if (timer) clearTimeout(timer); if (e && e.name === 'AbortError') { e = new Error('The server took too long to answer.'); e.net = true; } else if (e instanceof TypeError) e.net = true; throw e; });
  }
  function isNet(e) { return !!(e && e.net); }
  function raw(action, args, extra) {
    var req = { action: action, token: session.get('sg_token'), args: args || {} };
    if (extra) Object.keys(extra).forEach(function (k) { req[k] = extra[k]; });
    return send(JSON.stringify(req)).then(function (r) {
      if (r && r.ok) { setOnline(true); return r; }
      if (r && r.code === 'AUTH') { API.setToken(''); API.onAuthLost(); }
      throw new Error((r && r.error) || 'Request failed.');
    });
  }

  // ---------- reads: instant repeat views, de-duplicated, saved locally for offline ----------
  function stable(v) { if (Array.isArray(v)) return v.map(stable); if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { if (v[k] !== undefined) o[k] = stable(v[k]); }); return o; } return v; }
  function readKey(action, args) { return action + '|' + JSON.stringify(stable(args || {})); }
  function persistKey(key) { return key.indexOf('app.boot|') === 0 ? 'boot' : 'r:' + user() + ':' + key; }
  function persist(key, data) {
    if (key.indexOf('app.boot|') !== 0 && !user()) return;
    try { var s = JSON.stringify(data); if (s.length < 800000) kv.set(persistKey(key), { t: Date.now(), d: data }); } catch (e) {}
  }
  function read(action, args, opts) {
    var key = readKey(action, args), m = memCache[key];
    if (m && Date.now() - m.t < MEM_TTL && !(opts && opts.fresh)) return Promise.resolve(clone(m.d));
    if (inflight[key]) return inflight[key].then(clone);
    var p = raw(action, args).then(function (r) {
      memCache[key] = { t: Date.now(), d: r.data }; persist(key, r.data);
      if (state.stale) { state.stale = 0; emit('fresh'); }
      return r.data;
    }, function (e) {
      if (!isNet(e)) throw e;
      setOnline(false);
      return kv.get(persistKey(key)).then(function (rec) {
        if (!rec) throw new Error('You are offline and this screen has not been opened on this device yet.');
        state.stale = rec.t; emit('stale'); return rec.d;
      });
    }).then(function (d) { delete inflight[key]; return d; }, function (e) { delete inflight[key]; throw e; });
    inflight[key] = p;
    return p.then(clone);
  }

  // ---------- writes: retried safely (same op id), queued when the server cannot be reached ----------
  function write(action, args) {
    var opId = uuid();
    function attempt(n) {
      return raw(action, args, { op_id: opId, retry: n > 0 }).then(function (r) { memCache = {}; flushSoon(); return r.data; }, function (e) {
        if (!isNet(e)) throw e;
        if (n < 2 && state.online && (typeof navigator === 'undefined' || navigator.onLine !== false)) return delay(1500 * (n + 1)).then(function () { return attempt(n + 1); });
        setOnline(false);
        if (QUEUEABLE[action] && user()) return enqueue(action, args, opId);
        throw new Error('You are offline, so this could not be saved. Please try again when the connection is back.');
      });
    }
    return attempt(0);
  }
  function enqueue(action, args, opId) {
    var rec = { op_id: opId, action: action, args: clone(args), user: user(), at: Date.now(), status: 'pending', error: '' };
    return outbox.add(rec).then(function () { pending.push(rec); emit('queued'); return { queued: true, op_id: opId }; });
  }
  var syncTimer = null;
  function flushSoon() { if (pending.some(function (p) { return p.status === 'pending' && p.user === user(); })) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 800); } }
  function sync() {
    if (state.syncing || !session.get('sg_token')) return Promise.resolve();
    var list = pending.filter(function (p) { return p.status === 'pending' && p.user === user(); }).slice(0, 25);
    if (!list.length) return Promise.resolve();
    state.syncing = true; emit('syncing');
    return send(JSON.stringify({ action: 'batch', token: session.get('sg_token'), ops: list.map(function (p) { return { action: p.action, args: p.args, op_id: p.op_id, retry: true }; }) })).then(function (r) {
      if (r && r.code === 'AUTH') { API.setToken(''); API.onAuthLost(); return; }
      if (!r || !r.ok) throw new Error((r && r.error) || 'Sync failed.');
      setOnline(true); memCache = {};
      return Promise.all(r.data.map(function (res, i) {
        var p = list[i];
        if (res.ok) { pending = pending.filter(function (x) { return x.seq !== p.seq; }); return outbox.del(p.seq); }
        p.status = 'failed'; p.error = res.error || 'The server refused this change.'; return outbox.put(p);
      }));
    }).then(function () { return null; }, function (e) { if (isNet(e)) setOnline(false); }).then(function () {
      state.syncing = false; emit('synced');
      if (state.online && pending.some(function (p) { return p.status === 'pending' && p.user === user(); })) return sync();
    });
  }
  function probe() {
    var url = endpoint(); if (IN_GAS || !url) return Promise.resolve(state.online);
    return fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'ping=1&_=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { return !!(j && j.ok); }, function () { return false; });
  }
  function tick() {
    var want = !state.online || pending.some(function (p) { return p.status === 'pending'; });
    if (!want) return;
    probe().then(function (ok) { if (ok) { setOnline(true); sync(); } else setOnline(false); });
  }

  var API = window.API = {
    inGas: !!IN_GAS,
    needsUrl: function () { return !IN_GAS && !endpoint(); },
    setUrl: function (u) { local.set('sg_url', u.trim()); },
    getUrl: endpoint,
    token: function () { return session.get('sg_token'); },
    setToken: function (t) { t ? session.set('sg_token', t) : session.del('sg_token'); },
    setUser: function (name) { local.set('sg_user', name || ''); },
    onAuthLost: function () {},
    setWrites: function (list) { WRITES = {}; (list || []).forEach(function (a) { WRITES[a] = 1; }); kv.set('writes', list || []); },
    loadWrites: function () { return kv.get('writes').then(function (l) { if (l && !Object.keys(WRITES).length) API.setWrites(l); }); },
    call: function (action, args, opts) {
      args = args || {};
      if (action.indexOf('auth.') === 0) return raw(action, args).then(function (r) { return r.data; });     // sign-in/out is never cached or queued
      return WRITES[action] ? write(action, args) : read(action, args, opts);
    },
    /** Warm the local copy of the screens people use most, in ONE round trip. */
    prefetch: function (list) {
      if (!state.online || !user()) return Promise.resolve();
      return send(JSON.stringify({ action: 'batch', token: session.get('sg_token'), ops: list.map(function (x) { return { action: x[0], args: x[1] || {} }; }) })).then(function (r) {
        if (!r || !r.ok) return;
        r.data.forEach(function (res, i) { if (res.ok) { var key = readKey(list[i][0], list[i][1]); memCache[key] = { t: Date.now(), d: res.data }; persist(key, res.data); } });
      }).catch(function () {});
    },
    ping: function () {
      if (IN_GAS) return Promise.resolve(true);
      return fetch(endpoint() + (endpoint().indexOf('?') === -1 ? '?' : '&') + 'ping=1').then(function (r) { return r.json(); }).then(function (j) { return !!(j && j.ok); });
    },
    // ---- offline queue ----
    status: function () { return { online: state.online, syncing: state.syncing, stale: state.stale, pending: pending.filter(function (p) { return p.status === 'pending' && p.user === user(); }).length, failed: pending.filter(function (p) { return p.status === 'failed' && p.user === user(); }).length }; },
    onStatus: function (f) { listeners.push(f); },
    queue: function () { return pending.filter(function (p) { return p.user === user(); }).map(clone); },
    sync: function () { return probe().then(function (ok) { if (ok) setOnline(true); return sync(); }); },
    retryFailed: function () { return Promise.all(pending.filter(function (p) { return p.status === 'failed' && p.user === user(); }).map(function (p) { p.status = 'pending'; p.error = ''; return outbox.put(p); })).then(function () { emit('queued'); return sync(); }); },
    discard: function (seq) { pending = pending.filter(function (p) { return p.seq !== seq; }); return outbox.del(seq).then(function () { emit('synced'); }); },
    /** Forget the saved screens of this user (sign-out). Unsent offline work is kept. */
    wipe: function () { memCache = {}; var u = user(); return kv.keys().then(function (ks) { return Promise.all((ks || []).filter(function (k) { return k === 'boot' || k.indexOf('r:' + u + ':') === 0; }).map(function (k) { return kv.del(k); })); }).then(function () { local.set('sg_user', ''); }); },
    clearMemory: function () { memCache = {}; }
  };

  outbox.all().then(function (a) { pending = a; emit('loaded'); setTimeout(flushSoon, 1500); });
  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () { setOnline(true); tick(); });
    window.addEventListener('offline', function () { setOnline(false); });
    setInterval(tick, 20000);
    // installable + opens with no connection (GitHub Pages only: Apps Script pages cannot register one)
    if (!IN_GAS && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
        navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'updated') emit('update'); });
      });
    }
  }
})();
