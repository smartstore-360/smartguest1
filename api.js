/* api.js - one call() for both hosts: google.script.run inside Apps Script, fetch() from GitHub Pages. */
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

  function send(body) {
    if (IN_GAS) {
      return new Promise(function (resolve, reject) {
        google.script.run.withSuccessHandler(resolve).withFailureHandler(function (e) { reject(new Error(e && e.message ? e.message : 'Server error.')); }).rpc(body);
      });
    }
    var url = endpoint();
    if (!url) return Promise.reject(new Error('NO_URL'));
    // text/plain keeps this a "simple" CORS request, so the browser sends no preflight (Apps Script cannot answer one).
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('Server returned ' + r.status); return r.json(); })
      .catch(function (e) { if (e instanceof SyntaxError) throw new Error('The server did not return data. Check that the Web App is deployed for "Anyone" and the URL is correct.'); throw e; });
  }

  window.API = {
    inGas: !!IN_GAS,
    needsUrl: function () { return !IN_GAS && !endpoint(); },
    setUrl: function (u) { local.set('sg_url', u.trim()); },
    getUrl: endpoint,
    token: function () { return session.get('sg_token'); },
    setToken: function (t) { t ? session.set('sg_token', t) : session.del('sg_token'); },
    onAuthLost: function () {},
    call: function (action, args) {
      return send(JSON.stringify({ action: action, token: session.get('sg_token'), args: args || {} })).then(function (r) {
        if (r && r.ok) return r.data;
        if (r && r.code === 'AUTH') { window.API.setToken(''); window.API.onAuthLost(); }
        throw new Error((r && r.error) || 'Request failed.');
      });
    },
    ping: function () {
      if (IN_GAS) return Promise.resolve(true);
      return fetch(endpoint() + (endpoint().indexOf('?') === -1 ? '?' : '&') + 'ping=1').then(function (r) { return r.json(); }).then(function (j) { return !!(j && j.ok); });
    }
  };
})();
