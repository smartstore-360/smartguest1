/* SmartGuest front end - plain JavaScript, no build step. Works inside Apps Script and on GitHub Pages. */
(function () {
  'use strict';
  var APP_VERSION = '2026.11.10-b';
  var S = { user: null, hotel: null, methods: [], route: 'dashboard' };
  var $app = document.getElementById('app');

  // ---------- helpers ----------
  function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function can(p) { return !!(S.user && S.user.permissions.indexOf(p) !== -1); }
  function cur() { return (S.hotel && S.hotel.currency_symbol) || 'GH₵'; }
  function money(n) { n = Number(n || 0); var s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < 0 ? '-' : '') + cur() + s; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(s, n) { var p = s.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2] + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function pill(s) { return '<span class="pill s-' + esc(s) + '">' + esc(String(s).replace(/_/g, ' ')) + '</span>'; }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
  function toast(msg, err) { var t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.getElementById('toasts').appendChild(t); setTimeout(function () { t.remove(); }, err ? 6000 : 3200); }
  function fail(e) { if (e && e.message === 'NO_URL') return connectScreen(); toast(e && e.message ? e.message : 'Something went wrong.', true); }
  function formData(form) { var o = {}; new FormData(form).forEach(function (v, k) { o[k] = v; }); Array.prototype.forEach.call(form.querySelectorAll('input[type=checkbox]'), function (c) { o[c.name] = c.checked; }); return o; }
  function opts(list, valueKey, labelFn, sel) { return list.map(function (x) { return '<option value="' + esc(x[valueKey]) + '"' + (String(x[valueKey]) === String(sel) ? ' selected' : '') + '>' + esc(labelFn(x)) + '</option>'; }).join(''); }
  function table(head, rows, empty) {
    if (!rows.length) return '<div class="empty">' + esc(empty || 'Nothing to show.') + '</div>';
    return '<div class="wrap"><table><thead><tr>' + head.map(function (h) { return '<th' + (h.charAt(0) === '>' ? ' class="r"' : '') + '>' + esc(h.replace(/^>/, '')) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function busy(btn, fn) {
    if (btn.disabled) return; btn.disabled = true;
    Promise.resolve().then(fn).catch(fail).then(function () { btn.disabled = false; });
  }

  // ---------- modal ----------
  var modals = [];
  function modal(title, html, onMount) {
    var bg = document.createElement('div'); bg.className = 'modalbg';
    bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h3><span>' + esc(title) + '</span><button class="x" data-close aria-label="Close">×</button></h3><div class="mbody">' + html + '</div></div>';
    document.body.appendChild(bg); modals.push(bg);
    var api = { el: bg.querySelector('.mbody'), close: function () { bg.remove(); modals = modals.filter(function (m) { return m !== bg; }); }, setHtml: function (h) { api.el.innerHTML = h; } };
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) api.close(); });
    bg.querySelector('[data-close]').addEventListener('click', api.close);
    if (onMount) onMount(api);
    return api;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modals.length) modals[modals.length - 1].querySelector('[data-close]').click(); });


  // ---------- connection bar, offline queue ----------
  function hhmm(ts) { var d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function opLabel(p) {
    var a = p.args || {};
    switch (p.action) {
      case 'payments.receive': return 'Payment ' + money(a.amount) + (a.notes ? ' — ' + a.notes : '');
      case 'folio.addCharge': return 'Charge: ' + (a.description || '') + ' ' + money(Number(a.unit_amount || 0) * Number(a.quantity || 1));
      case 'housekeeping.setStatus': return 'Room status → ' + String(a.status || '').replace(/_/g, ' ');
      case 'expenses.create': return 'Expense: ' + (a.payee || '') + ' ' + money(a.amount);
      case 'inventory.move': return 'Stock ' + (a.movement_type || '') + ' ' + (a.quantity || '');
      case 'outlet.sell': return 'Sale at ' + String(a.outlet || '').replace(/_/g, ' ') + ' (' + (a.items || []).length + ' item(s))';
      default: return p.action;
    }
  }
  function renderNetbar() {
    var el = document.getElementById('netbar'); if (!el) { el = document.createElement('div'); el.id = 'netbar'; document.body.appendChild(el); }
    var st = API.status(), parts = [], cls = '';
    if (!st.online) { cls = 'off'; parts.push('<b>Offline</b> — you can keep working' + (st.stale ? '. Showing what was saved at ' + hhmm(st.stale) : '')); }
    else if (st.syncing) { cls = 'sync'; parts.push('Syncing…'); }
    if (st.pending) { if (!cls) cls = 'sync'; parts.push(st.pending + ' change' + (st.pending > 1 ? 's' : '') + ' waiting to sync'); }
    if (st.failed) { cls = 'bad'; parts.push('<b>' + st.failed + ' change' + (st.failed > 1 ? 's' : '') + ' could not be saved</b>'); }
    if (S.updateReady) { if (!cls) cls = 'sync'; parts.push('A new version is ready'); }
    if (!parts.length) { el.style.display = 'none'; return; }
    el.className = cls; el.style.display = '';
    el.innerHTML = '<span>' + parts.join(' · ') + '</span>' + (st.pending || st.failed ? ' <button class="sm sec" data-act="queue">Review</button>' : '') + (st.online && st.pending ? ' <button class="sm sec" data-act="syncnow">Sync now</button>' : '') + (S.updateReady ? ' <button class="sm sec" data-act="reload">Reload</button>' : '');
  }
  function queueModal() {
    var q = API.queue();
    var m = modal('Changes made on this device', (q.length ? '<p class="muted">These were saved while the server could not be reached. They are sent automatically, in order. If the server refuses one (for example the guest has since checked out) it stays here so nothing is lost silently.</p>' : '') +
      table(['When', 'Change', 'Status', ''], q.map(function (p) { return '<tr><td>' + hhmm(p.at) + '</td><td>' + esc(opLabel(p)) + '</td><td>' + (p.status === 'failed' ? '<span class="pill bad">refused</span><div class="muted">' + esc(p.error) + '</div>' : '<span class="pill warn">waiting</span>') + '</td><td class="actions"><button class="sm sec" data-qdiscard="' + p.seq + '">Discard</button></td></tr>'; }), 'Nothing is waiting. Everything is saved on the server.') +
      (q.length ? '<div class="actions"><button data-qretry>Try again now</button></div>' : ''), function (mm) {
      Array.prototype.forEach.call(mm.el.querySelectorAll('[data-qdiscard]'), function (b) { b.onclick = function () { if (confirm('Discard this change? It will NOT be saved to the server.')) API.discard(Number(b.getAttribute('data-qdiscard'))).then(function () { mm.close(); queueModal(); }); }; });
      var r = mm.el.querySelector('[data-qretry]'); if (r) r.onclick = function () { API.retryFailed().then(function () { mm.close(); queueModal(); }); };
    });
    return m;
  }
  function pendingOps(action) { return API.queue().filter(function (p) { return p.action === action && p.status === 'pending'; }); }
  var lastQ = -1;
  API.onStatus(function (st, type) {
    renderNetbar();
    if (type === 'queued') toast('Saved on this device. It will sync automatically when the connection is back.');
    if (type === 'update') { S.updateReady = true; renderNetbar(); }
    if (type === 'online') toast('Back online.');
    var n = st.pending + st.failed;
    if (type === 'synced' && S.user && n < lastQ && !modals.length) refresh();      // something was sent: show the real data
    lastQ = n;
  });

  // ---------- shell ----------
  var PAGES = [
    ['dashboard', 'Dashboard', 'frontdesk.view'], ['frontdesk', 'Front Desk', 'frontdesk.view'], ['reservations', 'Reservations', 'reservations.view'],
    ['guests', 'Guests', 'guests.view'], ['rooms', 'Rooms', 'rooms.view'], ['housekeeping', 'Housekeeping', 'housekeeping.view'], ['restaurant', 'Restaurant', 'restaurant.view'], ['outlets', 'Services & Shops', ['bar.view', 'gift_shop.view', 'business_centre.view', 'salon.view', 'spa.view', 'laundry.view', 'gym.view', 'pool.view', 'parking.view', 'transport.view']], ['inventory', 'Inventory', 'inventory.view'], ['expenses', 'Expenses', 'expenses.view'], ['roomservice', 'Room Service', 'room_service.view'], ['carrental', 'Car Rental', 'car_rental.view'], ['events', 'Events', 'events.view'], ['payroll', 'Payroll', 'payroll.view'], ['accounting', 'Accounting', 'accounting.view'], ['refunds', 'Refunds', 'payments.reverse'], ['maintenance', 'Maintenance', 'maintenance.view'], ['followups', 'Open Orders', 'followups.manage'], ['rateplans', 'Rate Plans', 'rooms.view'],
    ['reports', 'Reports', 'reports.view'], ['users', 'Users & Roles', 'users.manage'], ['settings', 'Settings', null], ['audit', 'Audit Log', 'audit.view']
  ];
  var PAGE_MODULE = { restaurant: 'restaurant', roomservice: 'roomservice', inventory: 'inventory', carrental: 'carrental', events: 'events', payroll: 'payroll', accounting: 'accounting', maintenance: 'maintenance', rateplans: 'rateplans', followups: 'followups' };
  function modOff(id) { return (S.off || []).indexOf(id) !== -1; }
  function pageOn(id) { if (id === 'outlets') return Object.keys(OUTLET_LABELS).some(function (k) { return !modOff('outlet:' + k); }); return !PAGE_MODULE[id] || !modOff(PAGE_MODULE[id]); }
  function allowedPages() { return PAGES.filter(function (p) { return pageOn(p[0]) && (!p[2] || (Array.isArray(p[2]) ? p[2].some(can) : can(p[2]))); }); }

  function render() {
    var pages = allowedPages();
    if (!pages.some(function (p) { return p[0] === S.route; })) S.route = pages.length ? pages[0][0] : 'settings';
    $app.innerHTML = '<div class="shell"><aside class="side">' + logoImg('side-logo') + '<div class="brand">SmartGuest<small>Hotel Management System</small></div><div class="hotelname">' + esc(S.hotel ? S.hotel.name : '') + '</div><nav class="nav">' +
      pages.map(function (p) { return '<a href="#' + p[0] + '" class="' + (p[0] === S.route ? 'on' : '') + '">' + esc(p[1]) + '</a>'; }).join('') +
      '</nav></aside><main class="main"><div class="top"><h2 id="title"></h2><span class="who">' + esc(S.user.full_name) + ' · ' + esc(S.user.role) + '</span><button class="sec sm" data-act="logout">Sign out</button></div><div id="view"></div></main></div>';
    var p = PAGES.filter(function (x) { return x[0] === S.route; })[0];
    document.getElementById('title').textContent = p ? p[1] : '';
    document.title = 'SmartGuest'; document.body.classList.remove('is-login');
    var v = document.getElementById('view'); v.innerHTML = '<div class="empty">Loading…</div>';
    (VIEWS[S.route] || VIEWS.dashboard)(v).catch(function (e) { v.innerHTML = '<div class="card err">' + esc(e.message) + '</div>'; fail(e); });
  }
  window.addEventListener('hashchange', function () { if (S.user) { S.route = location.hash.slice(1) || 'dashboard'; render(); } });
  function refresh() { render(); }

  // ---------- screens: connect / login ----------
  function connectScreen(msg) {
    $app.innerHTML = '<div class="login"><div class="brand">SmartGuest<small>Connect to your server</small></div><div class="card"><p class="muted">Paste the <b>Web App URL</b> of your Apps Script deployment (it ends in <code>/exec</code>).</p><form id="cf"><div class="f"><label>Web App URL</label><input name="url" required placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(API.getUrl() || '') + '"></div><div class="err" id="ce">' + esc(msg || '') + '</div><button type="submit">Connect</button></form></div></div>';
    document.getElementById('cf').onsubmit = function (e) {
      e.preventDefault(); var u = e.target.url.value.trim(), b = e.target.querySelector('button');
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(u) && !/^https:\/\/script\.google\.com\/a\/macros\/.+\/exec$/.test(u)) { document.getElementById('ce').textContent = 'That does not look like an Apps Script Web App URL.'; return; }
      API.setUrl(u); b.disabled = true;
      API.ping().then(function (ok) { if (!ok) throw new Error('x'); start(); }).catch(function () { document.getElementById('ce').textContent = 'Could not reach that URL. Check the deployment is set to "Anyone" and try again.'; b.disabled = false; });
    };
  }


  // ----- branding: logo + colours (kept on this device so the sign-in page looks right before anyone logs in) -----
  function shade(hex, f) { var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; function m(x) { return Math.max(0, Math.min(255, Math.round(x * f))); } return '#' + [m(r), m(g), m(b)].map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function applyBrand(b) {
    b = b || {}; S.brand = b; var st = document.documentElement.style;
    if (b.color) st.setProperty('--navy', b.color); else st.removeProperty('--navy');
    if (b.accent) { st.setProperty('--accent', b.accent); st.setProperty('--accent-strong', shade(b.accent, .62)); } else { st.removeProperty('--accent'); st.removeProperty('--accent-strong'); }
    try { localStorage.setItem('sg_brand', JSON.stringify(b)); } catch (e) {}
  }
  try { applyBrand(JSON.parse(localStorage.getItem('sg_brand') || '{}')); } catch (e) { S.brand = {}; }
  function logoImg(cls) { return S.brand && S.brand.logo ? '<img class="' + cls + '" src="' + S.brand.logo + '" alt="">' : ''; }
  function loginScreen(msg) {
    document.body.classList.add('is-login'); document.title = 'SmartGuest';
    $app.innerHTML = '<div class="login classic"><div class="crest" id="lcrest" aria-hidden="true">' + logoImg('lg-logo') + (S.brand && S.brand.logo ? '' : '<svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width=".75"/><path d="M16 42V27l16-10 16 10v15h-9V32H25v10z" fill="currentColor"/><circle cx="32" cy="29" r="3" fill="#14213d"/></svg>') + '</div>' +
      '<h1 class="lg-name">SmartGuest</h1><div class="lg-sub" id="lsub">' + esc((S.brand && (S.brand.tagline || S.brand.name)) || 'Hotel Management System') + '</div><div class="orn"><i></i></div>' +
      '<div class="lg-card"><h2>Welcome</h2><p class="lg-hint">Please sign in to continue</p><form id="lf"><div class="f"><label>Username</label><input name="username" autocomplete="username" required autofocus></div><div class="f"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div><div class="err" id="le">' + esc(msg || '') + '</div><button type="submit" class="lg-btn">Sign in</button></form></div>' +
      '<div class="lg-foot">Authorised staff only<br><span style="opacity:.55">v' + APP_VERSION + '</span></div></div>';
    API.call('app.brand').then(function (b) { if (!document.getElementById('lcrest')) return; applyBrand(b); var c = document.getElementById('lcrest'); if (b.logo) c.innerHTML = logoImg('lg-logo'); document.getElementById('lsub').textContent = b.tagline || b.name || 'Hotel Management System'; }).catch(function () {});
    document.getElementById('lf').onsubmit = function (e) {
      e.preventDefault(); var f = e.target, b = f.querySelector('button'), le = document.getElementById('le'); b.disabled = true; le.textContent = '';
      API.call('auth.login', { username: f.username.value, password: f.password.value }).then(function (d) { API.setToken(d.token); S.user = d.user; return boot(); })
        .catch(function (err) {
          if (err.message === 'NO_URL') return connectScreen();
          le.textContent = err.message; b.disabled = false;
          // the server address is only offered when the server could not be reached at all
          if (!API.inGas && /reach|took too long|Failed to fetch|Server returned|did not return data|offline/i.test(err.message)) { var a = document.createElement('a'); a.href = '#'; a.textContent = ' Change server address'; a.onclick = function (ev) { ev.preventDefault(); connectScreen(); }; le.appendChild(a); }
        });
    };
  }

  function boot() {
    return API.call('app.boot').then(function (r) {
      S.user = r.user; S.hotel = r.hotel; if (r.brand) applyBrand(r.brand); S.off = r.modules_off || []; S.methods = r.methods; API.setUser(r.user.username); API.setWrites(r.writes);
      S.route = location.hash.slice(1) || 'dashboard'; render(); warmCache();
    });
  }
  // Save the busiest screens on this device (one round trip) so they still open if the connection drops.
  function warmCache() {
    var want = [['rooms.list', 'rooms.view'], ['roomTypes.list', 'rooms.view'], ['frontdesk.arrivals', 'frontdesk.view'], ['frontdesk.inHouse', 'frontdesk.view'], ['housekeeping.board', 'housekeeping.view'], ['dashboard.get', 'frontdesk.view'],
      ['guests.list', 'guests.view', { q: '' }], ['reservations.list', 'reservations.view', { status: '', q: '' }], ['restaurant.menu', 'restaurant.view'], ['inventory.data', 'inventory.view'], ['payments.methods', null]];
    var list = want.filter(function (w) { return !w[1] || can(w[1]); }).map(function (w) { return [w[0], w[2] || {}]; });
    setTimeout(function () { API.prefetch(list); }, 1200);
  }
  function start() {
    if (API.needsUrl()) return connectScreen();
    if (!API.token()) return loginScreen();
    API.loadWrites().then(function () { return boot(); }).catch(function (e) { if (e.message === 'NO_URL') return connectScreen(); loginScreen(e.message && !/session/i.test(e.message) ? 'Could not reach the server: ' + e.message : ''); });
  }
  API.onAuthLost = function () { S.user = null; loginScreen('Your session has expired. Please sign in again.'); };

  // ---------- views ----------
  var VIEWS = {};

  VIEWS.dashboard = function (v) {
    return API.call('dashboard.get').then(function (d) {
      var order = ['available', 'reserved', 'occupied', 'dirty', 'cleaning', 'clean', 'inspected', 'maintenance', 'out_of_service', 'blocked'];
      v.innerHTML = '<div class="grid g4"><div class="stat"><span>Occupancy</span><b>' + d.occupancy_pct + '%</b></div><div class="stat"><span>In house</span><b>' + d.in_house + '</b></div>' +
        '<div class="stat"><span>Arrivals today</span><b>' + d.arrivals_today + '</b></div><div class="stat"><span>Departures due</span><b>' + d.departures_due + '</b></div>' +
        '<div class="stat"><span>Payments today</span><b>' + money(d.payments_today) + '</b></div></div>' +
        '<div class="card" style="margin-top:16px"><h3>Rooms by status (' + d.total_rooms + ' active)</h3><div class="row">' +
        order.filter(function (s) { return d.status_counts[s]; }).map(function (s) { return '<div class="stat" style="flex:0 1 150px">' + pill(s) + '<b>' + d.status_counts[s] + '</b></div>'; }).join('') + '</div></div>';
    });
  };

  // ----- front desk -----
  VIEWS.frontdesk = function (v) {
    var tab = S.fdTab || 'arrivals';
    return Promise.all([API.call('frontdesk.arrivals'), API.call('frontdesk.inHouse')]).then(function (r) {
      var arr = r[0], inh = r[1];
      var arrRows = [];
      arr.forEach(function (res) {
        res.rooms.filter(function (x) { return x.status === 'booked'; }).forEach(function (rr) {
          arrRows.push('<tr><td>' + esc(res.reservation_number) + '</td><td>' + esc(res.guest_name) + '</td><td>' + esc(rr.room_number) + '</td><td>' + esc(res.arrival_date) + ' → ' + esc(res.departure_date) + '</td><td class="r">' + money(rr.rate) + '</td><td class="actions">' +
            (can('frontdesk.checkin') ? '<button class="sm" data-act="checkin" data-rr="' + rr.id + '" data-label="' + esc(res.guest_name + ' · Room ' + rr.room_number) + '">Check in</button>' : '') + '</td></tr>');
        });
      });
      var inRows = inh.map(function (s) {
        return '<tr><td>' + esc(s.room_number) + '</td><td>' + esc(s.guest_name) + '</td><td>' + esc(s.checkin_at.substr(0, 10)) + '</td><td>' + esc(s.departure_date) + '</td><td class="r ' + (s.balance > 0 ? 'neg' : '') + '">' + money(s.balance) + '</td><td class="actions">' +
          (can('folio.view') ? '<button class="sm sec" data-act="folio" data-stay="' + s.id + '">Folio</button>' : '') +
          (can('frontdesk.checkout') ? '<button class="sm" data-act="checkout" data-stay="' + s.id + '">Check out</button>' : '') + '</td></tr>';
      });
      v.innerHTML = '<div class="tabs"><button data-act="fdtab" data-tab="arrivals" class="' + (tab === 'arrivals' ? 'on' : '') + '">Arrivals (' + arrRows.length + ')</button><button data-act="fdtab" data-tab="inhouse" class="' + (tab === 'inhouse' ? 'on' : '') + '">In house (' + inRows.length + ')</button>' +
        (can('frontdesk.checkout') ? '<span style="flex:1"></span><button class="sec sm" data-act="nightaudit" title="Posts any room nights not yet charged">Run night audit</button>' : '') + '</div><div class="card">' +
        (tab === 'arrivals' ? table(['Reservation', 'Guest', 'Room', 'Dates', '>Rate', ''], arrRows, 'No arrivals waiting.') : table(['Room', 'Guest', 'Checked in', 'Departs', '>Balance', ''], inRows, 'No guests in house.')) + '</div>';
    });
  };

  function checkinModal(rrId, label) {
    modal('Check in — ' + label, '<form id="ci"><div class="row"><div class="f"><label>Deposit (optional)</label><input name="deposit_amount" type="number" step="0.01" min="0" placeholder="0.00"></div><div class="f"><label>Paid by</label><select name="deposit_method_id">' + opts(S.methods, 'id', function (m) { return m.name; }) + '</select></div></div>' +
      (can('frontdesk.override_unavailable') ? '<label class="chk f"><input type="checkbox" name="override_unavailable"> Override room status (dirty / cleaning / maintenance)</label>' : '') +
      '<div class="actions"><button type="submit">Confirm check-in</button></div></form>', function (m) {
      m.el.querySelector('#ci').onsubmit = function (e) {
        e.preventDefault(); var d = formData(e.target); d.reservation_room_id = Number(rrId);
        busy(e.target.querySelector('button'), function () { return API.call('frontdesk.checkIn', d).then(function () { m.close(); toast('Guest checked in.'); refresh(); }); });
      };
    });
  }

  function checkoutModal(stayId) {
    API.call('frontdesk.checkoutPreview', { stay_id: Number(stayId) }).then(function (p) {
      var owed = p.projected_balance > 0.009, credit = p.projected_balance < -0.009;
      modal('Check out', '<div class="kv"><b>Nights to post</b><span>' + p.nights_due + ' × ' + money(p.rate) + '</span><b>Balance now</b><span>' + money(p.current_balance) + '</span><b>Balance at checkout</b><span class="total ' + (owed ? 'neg' : '') + '">' + money(p.projected_balance) + '</span></div><form id="co" style="margin-top:14px">' +
        (owed ? (can('payments.checkout_with_balance') ? '<label class="chk f"><input type="checkbox" name="allow_balance"> Approve checkout with an outstanding balance</label>' : '<p class="err">There is an unpaid balance. Take payment in the folio, or ask a manager to approve.</p>') : '') +
        (credit ? '<p class="err">The guest is owed ' + esc(money(-p.projected_balance)) + '.</p><label class="chk f"><input type="checkbox" name="credit_ack"> I have settled or recorded this credit</label><div class="f"><label>How was it handled?</label><input name="credit_note" placeholder="e.g. refunded in cash"></div>' : '') +
        '<div class="actions"><button type="submit">Check out</button></div></form>', function (m) {
        m.el.querySelector('#co').onsubmit = function (e) {
          e.preventDefault(); var d = formData(e.target); d.stay_id = Number(stayId);
          busy(e.target.querySelector('button[type=submit]'), function () { return API.call('frontdesk.checkOut', d).then(function () { m.close(); toast('Guest checked out.'); refresh(); }); });
        };
      });
    }).catch(fail);
  }

  function folioModal(stayId, existing) {
    API.call('folio.get', { stay_id: Number(stayId) }).then(function (f) {
      var open = f.folio.status === 'open', key = uuid();
      var items = f.items.map(function (i) { return '<tr><td>' + esc(i.description) + '</td><td class="r">' + i.quantity + '</td><td class="r">' + money(i.amount) + '</td></tr>'; });
      var pays = f.payments.map(function (p) {
        return '<tr><td>' + esc(p.receipt_number) + '</td><td>' + esc(p.method_name) + (p.notes ? ' <span class="muted">· ' + esc(p.notes) + '</span>' : '') + '</td><td class="r ' + (p.amount < 0 ? 'neg' : '') + '">' + money(p.amount) + '</td><td class="actions">' +
          (can('invoicing.print') ? '<button class="sm sec" data-rcpt="' + p.id + '">Receipt</button>' : '') + (can('payments.reverse') && p.amount > 0 && p.status !== 'reversed' ? '<button class="sm danger" data-rev="' + p.id + '" data-max="' + p.amount + '">Reverse</button>' : (p.status === 'reversed' ? '<span class="pill">reversed</span>' : '')) + '</td></tr>';
      });
      var html = '<div class="kv"><b>Guest</b><span>' + esc(f.guest.full_name) + '</span><b>Room</b><span>' + esc(f.room) + '</span><b>Folio</b><span>' + esc(f.folio.folio_number) + ' ' + pill(open ? 'open' : 'closed') + '</span></div>' +
        '<h4 style="margin-top:14px">Charges</h4>' + table(['Description', '>Qty', '>Amount'], items, 'No charges yet.') +
        '<h4 style="margin-top:14px">Payments</h4>' + table(['Receipt', 'Method', '>Amount', ''], pays, 'No payments yet.') +
        (can('invoicing.print') ? '<div class="actions"><button class="sm sec" data-invoice="1">Print invoice</button></div>' : '') + '<div class="kv" style="margin-top:14px"><b>Charges</b><span>' + money(f.charges) + '</span><b>Paid</b><span>' + money(f.paid) + '</span><b>Balance</b><span class="total ' + (f.balance > 0 ? 'neg' : '') + '">' + money(f.balance) + '</span></div>' +
        (can('payments.receive') ? '<form id="pf" class="row" style="margin-top:14px;align-items:flex-end"><div class="f"><label>Receive payment</label><input name="amount" type="number" step="0.01" min="0.01" required placeholder="Amount"></div><div class="f"><label>Method</label><select name="payment_method_id">' + opts(S.methods, 'id', function (m) { return m.name; }) + '</select></div><div class="f"><label>Note</label><input name="notes"></div><div class="f" style="flex:0 0 auto"><button type="submit">Receive</button></div></form>' : '') +
        (open && can('folio.add_charge') ? '<form id="cf2" class="row" style="align-items:flex-end"><div class="f" style="flex:2 1 180px"><label>Add charge</label><input name="description" required placeholder="Description"></div><div class="f" style="flex:0 1 80px"><label>Qty</label><input name="quantity" type="number" min="1" step="1" value="1"></div><div class="f"><label>Unit amount</label><input name="unit_amount" type="number" min="0.01" step="0.01" required></div><div class="f" style="flex:0 0 auto"><button type="submit" class="sec">Add</button></div></form>' : '') +
        (open && can('folio.discount') ? '<form id="df" class="row" style="align-items:flex-end"><div class="f" style="flex:2 1 180px"><label>Discount</label><input name="description" placeholder="Reason"></div><div class="f"><label>Amount off</label><input name="amount" type="number" min="0.01" step="0.01" required></div><div class="f" style="flex:0 0 auto"><button type="submit" class="sec">Apply</button></div></form>' : '');
      var m = existing || modal('Guest folio', '');
      m.setHtml(html);
      var reload = function () { folioModal(stayId, m); refresh(); };
      var on = function (id, fn) { var el = m.el.querySelector(id); if (el) el.onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); busy(e.target.querySelector('button'), function () { return fn(d).then(function () { reload(); }); }); }; };
      on('#pf', function (d) { d.folio_id = f.folio.id; d.idempotency_key = key; key = uuid(); return API.call('payments.receive', d).then(function (r) { if (!r.queued) toast('Payment received — receipt ' + r.receipt_number); }); });
      on('#cf2', function (d) { d.folio_id = f.folio.id; return API.call('folio.addCharge', d).then(function (r) { if (!r.queued) toast('Charge added.'); }); });
      on('#df', function (d) { d.folio_id = f.folio.id; return API.call('folio.discount', d).then(function () { toast('Discount applied.'); }); });
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-rcpt]'), function (b) { b.onclick = function () { API.call('receipt.payment', { payment_id: Number(b.getAttribute('data-rcpt')) }).then(showReceipt).catch(fail); }; });
      var inv = m.el.querySelector('[data-invoice]'); if (inv) inv.onclick = function () { showReceipt({ kind: 'invoice', folio: f, copies: [''], printed_by: S.user.full_name, printed_at: new Date().toLocaleString(), hotel: S.hotel }); };
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-rev]'), function (b) {
        b.onclick = function () {
          var amt = prompt('Amount to reverse (max ' + b.getAttribute('data-max') + '):', b.getAttribute('data-max')); if (amt === null) return;
          var reason = prompt('Reason for the reversal:'); if (!reason) return;
          busy(b, function () { var pid = Number(b.getAttribute('data-rev')); return API.call('payments.reverse', { payment_id: pid, amount: amt, reason: reason }).then(function () { toast('Payment reversed.'); reload(); }, function (e) { if (!/need approval/.test(e.message)) throw e; return API.call('refunds.request', { payment_id: pid, amount: amt, reason: reason }).then(function () { toast('Refund request sent for approval.'); reload(); }); }); });
        };
      });
    }).catch(fail);
  }

  // ----- reservations -----
  VIEWS.reservations = function (v) {
    var f = S.resFilter || { status: '', q: '' };
    return API.call('reservations.list', f).then(function (list) {
      var rows = list.map(function (r) {
        var editable = r.status === 'confirmed' || r.status === 'pending';
        return '<tr><td>' + esc(r.reservation_number) + '</td><td>' + esc(r.guest_name) + '<div class="muted">' + esc(r.guest_phone) + '</div></td><td>' + r.rooms.map(function (x) { return esc(x.room_number); }).join(', ') + '</td><td>' + esc(r.arrival_date) + ' → ' + esc(r.departure_date) + ' <span class="muted">(' + r.nights + 'n)</span></td><td>' + pill(r.status) + '</td><td class="actions">' +
          (editable && can('reservations.edit') ? '<button class="sm sec" data-act="resdates" data-id="' + r.id + '" data-a="' + esc(r.arrival_date) + '" data-d="' + esc(r.departure_date) + '">Dates</button><button class="sm danger" data-act="rescancel" data-id="' + r.id + '">Cancel</button>' : '') + '</td></tr>';
      });
      v.innerHTML = '<div class="card"><form id="rf" class="row" style="align-items:flex-end"><div class="f"><label>Search</label><input name="q" placeholder="Number or guest" value="' + esc(f.q) + '"></div><div class="f"><label>Status</label><select name="status"><option value="">All</option>' +
        ['confirmed', 'pending', 'checked_in', 'checked_out', 'cancelled', 'no_show'].map(function (s) { return '<option' + (f.status === s ? ' selected' : '') + ' value="' + s + '">' + s.replace('_', ' ') + '</option>'; }).join('') + '</select></div><div class="f" style="flex:0 0 auto"><button type="submit" class="sec">Filter</button></div>' +
        (can('reservations.create') ? '<div class="f" style="flex:0 0 auto"><button type="button" class="gold" data-act="newres">+ New reservation</button></div>' : '') + '</form>' +
        table(['Number', 'Guest', 'Rooms', 'Dates', 'Status', ''], rows, 'No reservations found.') + '</div>';
      v.querySelector('#rf').onsubmit = function (e) { e.preventDefault(); S.resFilter = formData(e.target); refresh(); };
    });
  };

  function newReservation() {
    var arrival = today(), departure = addDays(today(), 1), picked = {};
    modal('New reservation', '<div id="nr"></div>', function (m) {
      var host = m.el.querySelector('#nr'), guestId = '', avail = [], err = '';
      function draw() {
        host.innerHTML = '<div class="f"><label>Guest</label><div class="row"><input id="gq" placeholder="Search by name, phone or code" style="flex:2 1 220px"><button type="button" class="sec" id="gs" style="flex:0 0 auto">Search</button>' + (can('guests.manage') ? '<button type="button" class="sec" id="gn" style="flex:0 0 auto">New guest</button>' : '') + '</div><select id="gsel" size="4" style="margin-top:6px"></select></div>' +
          '<div class="row"><div class="f"><label>Arrival</label><input type="date" id="ar" value="' + arrival + '"></div><div class="f"><label>Departure</label><input type="date" id="de" value="' + departure + '"></div><div class="f" style="flex:0 0 auto;align-self:flex-end"><button type="button" class="sec" id="fa">Find rooms</button></div></div>' +
          '<div id="rl">' + (avail.length ? roomPicker() : '<div class="muted">Choose dates, then Find rooms.</div>') + '</div><div class="f"><label>Special requests / notes</label><textarea id="nt" rows="2"></textarea></div><div class="err" id="ne">' + esc(err) + '</div><div class="actions"><button type="button" id="sv">Create reservation</button></div>';
        var gsel = host.querySelector('#gsel'); if (guestId) { gsel.innerHTML = '<option value="' + esc(guestId.id) + '" selected>' + esc(guestId.full_name) + '</option>'; }
        host.querySelector('#gs').onclick = function () { API.call('guests.list', { q: host.querySelector('#gq').value }).then(function (g) { gsel.innerHTML = g.length ? opts(g, 'id', function (x) { return x.full_name + ' · ' + (x.phone || x.guest_code); }) : '<option disabled>No match</option>'; gsel.onchange = function () { guestId = g.filter(function (x) { return String(x.id) === gsel.value; })[0]; }; if (g.length) { gsel.value = g[0].id; guestId = g[0]; } }).catch(fail); };
        var gn = host.querySelector('#gn'); if (gn) gn.onclick = function () { guestModal(null, function (g) { guestId = g; draw(); }); };
        host.querySelector('#fa').onclick = function () { arrival = host.querySelector('#ar').value; departure = host.querySelector('#de').value; API.call('rooms.available', { arrival: arrival, departure: departure }).then(function (r) { avail = r; picked = {}; err = ''; draw(); }).catch(function (e) { err = e.message; draw(); }); };
        host.querySelectorAll('[data-pick]').forEach(function (c) { c.onchange = function () { picked[c.getAttribute('data-pick')] = c.checked; }; });
        host.querySelector('#sv').onclick = function () {
          var rooms = avail.filter(function (r) { return picked[r.id]; }).map(function (r) {
            var q = function (s) { return host.querySelector('[data-' + s + '="' + r.id + '"]'); };
            return { room_id: r.id, adults: q('ad').value, children: q('ch').value, rate: can('reservations.override_rate') ? q('rt').value : '', rate_override_reason: can('reservations.override_rate') ? q('rr').value : '' };
          });
          if (!guestId) { err = 'Choose or create a guest.'; return draw(); }
          busy(host.querySelector('#sv'), function () { return API.call('reservations.create', { guest_id: guestId.id, arrival_date: arrival, departure_date: departure, rooms: rooms, source: 'walk_in', special_requests: host.querySelector('#nt').value }).then(function (r) { m.close(); toast('Reservation ' + r.reservation_number + ' created.'); refresh(); }).catch(function (e) { err = e.message; var el = host.querySelector('#ne'); if (el) el.textContent = err; }); });
        };
      }
      function roomPicker() {
        return '<div class="wrap"><table><thead><tr><th></th><th>Room</th><th>Type</th><th>Adults</th><th>Children</th>' + (can('reservations.override_rate') ? '<th>Rate</th><th>Reason if changed</th>' : '<th>Rate</th>') + '</tr></thead><tbody>' + avail.map(function (r) {
          return '<tr><td><input type="checkbox" data-pick="' + r.id + '"' + (picked[r.id] ? ' checked' : '') + '></td><td>' + esc(r.room_number) + '</td><td>' + esc(r.room_type) + ' <span class="muted">(max ' + r.max_occupancy + ')</span></td><td><input type="number" min="1" value="1" data-ad="' + r.id + '" style="width:64px"></td><td><input type="number" min="0" value="0" data-ch="' + r.id + '" style="width:64px"></td>' +
            (can('reservations.override_rate') ? '<td><input type="number" step="0.01" value="' + r.rate + '" data-rt="' + r.id + '" style="width:90px"></td><td><input data-rr="' + r.id + '"></td>' : '<td>' + money(r.rate) + '</td>') + '</tr>';
        }).join('') + '</tbody></table></div>';
      }
      draw();
    });
  }

  // ----- guests -----
  VIEWS.guests = function (v) {
    var q = S.guestQ || '';
    return API.call('guests.list', { q: q }).then(function (list) {
      v.innerHTML = '<div class="card"><form id="gf" class="row" style="align-items:flex-end"><div class="f"><label>Search</label><input name="q" placeholder="Name, phone, code or ID number" value="' + esc(q) + '"></div><div class="f" style="flex:0 0 auto"><button class="sec" type="submit">Search</button></div>' +
        (can('guests.manage') ? '<div class="f" style="flex:0 0 auto"><button type="button" class="gold" data-act="newguest">+ New guest</button></div>' : '') + '</form>' +
        table(['Code', 'Name', 'Phone', 'Nationality', 'Company', ''], list.map(function (g) { return '<tr><td>' + esc(g.guest_code) + '</td><td>' + esc(g.full_name) + '</td><td>' + esc(g.phone) + '</td><td>' + esc(g.nationality) + '</td><td>' + esc(g.company_name) + '</td><td class="actions">' + (can('guests.manage') ? '<button class="sm sec" data-act="editguest" data-id="' + g.id + '">Edit</button>' : '') + '</td></tr>'; }), 'No guests found.') + '</div>';
      v.querySelector('#gf').onsubmit = function (e) { e.preventDefault(); S.guestQ = e.target.q.value; refresh(); };
      S.guestCache = list;
    });
  };
  function guestModal(g, done) {
    g = g || {};
    modal(g.id ? 'Edit guest' : 'New guest', '<form id="gform"><div class="row"><div class="f"><label>Full name *</label><input name="full_name" required value="' + esc(g.full_name) + '"></div><div class="f"><label>Phone</label><input name="phone" value="' + esc(g.phone) + '"></div></div><div class="row"><div class="f"><label>Email</label><input name="email" type="email" value="' + esc(g.email) + '"></div><div class="f"><label>Gender</label><select name="gender">' +
      ['unspecified', 'male', 'female', 'other'].map(function (x) { return '<option' + (g.gender === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div></div><div class="row"><div class="f"><label>Nationality</label><input name="nationality" value="' + esc(g.nationality) + '"></div><div class="f"><label>Company</label><input name="company_name" value="' + esc(g.company_name) + '"></div></div><div class="row"><div class="f"><label>ID type</label><input name="id_type" value="' + esc(g.id_type) + '"></div><div class="f"><label>ID number</label><input name="id_number" value="' + esc(g.id_number) + '"></div></div><div class="f"><label>Address</label><input name="address" value="' + esc(g.address) + '"></div><div class="f"><label>Notes</label><textarea name="notes" rows="2">' + esc(g.notes) + '</textarea></div><div class="actions"><button type="submit">Save</button></div></form>', function (m) {
      m.el.querySelector('#gform').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); if (g.id) d.id = g.id; busy(e.target.querySelector('button'), function () { return API.call('guests.save', d).then(function (r) { m.close(); toast('Guest saved.'); if (done) done(r); else refresh(); }); }); };
    });
  }

  // ----- rooms -----
  VIEWS.rooms = function (v) {
    return Promise.all([API.call('rooms.list'), API.call('roomTypes.list')]).then(function (r) {
      var rooms = r[0], types = r[1]; S.roomCache = rooms; S.typeCache = types; var m = can('rooms.manage');
      v.innerHTML = '<div class="card"><h3>Rooms' + (m ? ' <button class="sm gold" data-act="newroom" style="float:right">+ Add room</button>' : '') + '</h3>' + table(['Room', 'Type', 'Floor', 'Status', 'Guest', '>Rate', ''], rooms.map(function (x) {
        return '<tr><td>' + esc(x.room_number) + (x.is_active ? '' : ' <span class="pill">inactive</span>') + '</td><td>' + esc(x.room_type) + '</td><td>' + esc(x.floor) + '</td><td>' + pill(x.status) + '</td><td>' + esc(x.guest_name || '') + '</td><td class="r">' + money(x.rate) + '</td><td class="actions">' + (m ? '<button class="sm sec" data-act="editroom" data-id="' + x.id + '">Edit</button>' : '') + '</td></tr>'; }), 'No rooms yet.') + '</div>' +
        '<div class="card"><h3>Room types' + (m ? ' <button class="sm gold" data-act="newtype" style="float:right">+ Add type</button>' : '') + '</h3>' + table(['Name', '>Base rate', '>Max guests', 'Active', ''], types.map(function (t) {
          return '<tr><td>' + esc(t.name) + '</td><td class="r">' + money(t.base_rate) + '</td><td class="r">' + t.max_occupancy + '</td><td>' + (t.is_active ? 'Yes' : 'No') + '</td><td class="actions">' + (m ? '<button class="sm sec" data-act="edittype" data-id="' + t.id + '">Edit</button>' : '') + '</td></tr>'; }), 'No room types yet.') + '</div>';
    });
  };
  function roomModal(x) {
    x = x || {};
    modal(x.id ? 'Edit room' : 'Add room', '<form id="rform"><div class="row"><div class="f"><label>Room number *</label><input name="room_number" required value="' + esc(x.room_number) + '"></div><div class="f"><label>Type *</label><select name="room_type_id">' + opts(S.typeCache.filter(function (t) { return t.is_active || t.id === x.room_type_id; }), 'id', function (t) { return t.name; }, x.room_type_id) + '</select></div></div><div class="row"><div class="f"><label>Building</label><input name="building" value="' + esc(x.building) + '"></div><div class="f"><label>Floor</label><input name="floor" value="' + esc(x.floor) + '"></div></div><div class="f"><label>Notes</label><input name="notes" value="' + esc(x.notes) + '"></div>' +
      '<label class="chk f"><input type="checkbox" name="is_active"' + (x.id && !x.is_active ? '' : ' checked') + '> Active</label><div class="actions"><button type="submit">Save</button></div></form>', function (m) {
      m.el.querySelector('#rform').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); if (x.id) d.id = x.id; busy(e.target.querySelector('button'), function () { return API.call('rooms.save', d).then(function () { m.close(); toast('Room saved.'); refresh(); }); }); };
    });
  }
  function typeModal(t) {
    t = t || {};
    modal(t.id ? 'Edit room type' : 'Add room type', '<form id="tform"><div class="f"><label>Name *</label><input name="name" required value="' + esc(t.name) + '"></div><div class="row"><div class="f"><label>Base rate *</label><input name="base_rate" type="number" step="0.01" min="0" required value="' + esc(t.base_rate) + '"></div><div class="f"><label>Max guests *</label><input name="max_occupancy" type="number" min="1" max="20" required value="' + esc(t.max_occupancy || 2) + '"></div></div><div class="f"><label>Description</label><input name="description" value="' + esc(t.description) + '"></div><label class="chk f"><input type="checkbox" name="is_active"' + (t.id && !t.is_active ? '' : ' checked') + '> Active</label><div class="actions"><button type="submit">Save</button></div></form>', function (m) {
      m.el.querySelector('#tform').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); if (t.id) d.id = t.id; busy(e.target.querySelector('button'), function () { return API.call('roomTypes.save', d).then(function () { m.close(); toast('Room type saved.'); refresh(); }); }); };
    });
  }

  // ----- housekeeping -----
  VIEWS.housekeeping = function (v) {
    return API.call('housekeeping.board').then(function (rooms) {
      pendingOps('housekeeping.setStatus').forEach(function (p) { rooms.forEach(function (r) { if (r.id === Number(p.args.room_id)) r.status = p.args.status; }); });
      var upd = can('housekeeping.update'), statuses = ['available', 'dirty', 'cleaning', 'clean', 'inspected', 'maintenance', 'out_of_service', 'blocked'];
      v.innerHTML = '<div class="roomgrid">' + rooms.map(function (r) {
        var locked = r.status === 'occupied' || r.status === 'reserved' && false;
        return '<div class="rc"><b>' + esc(r.room_number) + '</b> <span class="muted">' + esc(r.room_type) + '</span><div style="margin:6px 0">' + pill(r.status) + '</div>' + (r.guest_name ? '<div class="muted" style="font-size:.8rem">' + esc(r.guest_name) + '</div>' : '') +
          (upd && !r.stay_id ? '<select data-room="' + r.id + '">' + statuses.map(function (s) { return '<option value="' + s + '"' + (s === r.status ? ' selected' : '') + '>' + s.replace(/_/g, ' ') + '</option>'; }).join('') + (statuses.indexOf(r.status) === -1 ? '<option selected>' + esc(r.status) + '</option>' : '') + '</select>' : '') + '</div>';
      }).join('') + '</div>';
      v.querySelectorAll('[data-room]').forEach(function (s) { s.onchange = function () { s.disabled = true; API.call('housekeeping.setStatus', { room_id: Number(s.getAttribute('data-room')), status: s.value }).then(function (r) { if (!r.queued) toast('Room updated.'); refresh(); }).catch(function (e) { fail(e); refresh(); }); }; });
    });
  };


  // ----- restaurant -----
  VIEWS.restaurant = function (v) {
    var tab = S.rtab || 'orders', f = S.rfilter || 'active';
    var calls = [API.call('restaurant.orders', { status: f === 'all' ? '' : f }), API.call('restaurant.menu')];
    return Promise.all(calls).then(function (r) {
      var orders = r[0], menu = r[1]; S.menuCache = menu; var mg = can('restaurant.manage'), tx = can('restaurant.transact');
      var ordersHtml = '<div class="card"><div class="row" style="align-items:flex-end;margin-bottom:10px"><div class="f"><label>Show</label><select id="of">' + [['active', 'Open orders'], ['settled', 'Settled'], ['cancelled', 'Cancelled'], ['all', 'All']].map(function (x) { return '<option value="' + x[0] + '"' + (f === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' +
        (tx ? '<div class="f" style="flex:0 0 auto"><button class="gold" data-act="neworder">+ New order</button></div>' : '') + '</div>' +
        table(['Order', 'Table / Room', 'Type', 'Status', '>Total', ''], orders.map(function (o) {
          return '<tr><td>' + esc(o.order_number) + '</td><td>' + esc(o.room_number ? 'Room ' + o.room_number + ' · ' + o.guest_name : o.table_name || '—') + '</td><td>' + (o.settlement_type === 'room_charge' ? 'Room charge' : 'Walk-in') + '</td><td>' + pill(o.status) + '</td><td class="r">' + money(o.total) + '</td><td class="actions"><button class="sm sec" data-act="openorder" data-id="' + o.id + '">Open</button></td></tr>'; }), 'No orders.') + '</div>';
      var setupHtml = '<div class="grid g2"><div class="card"><h3>Menu' + (mg ? ' <button class="sm gold" data-act="newmenu" style="float:right">+ Add item</button>' : '') + '</h3>' + table(['Item', 'Category', '>Price', ''], menu.items.map(function (m) { return '<tr><td>' + esc(m.name) + (m.is_active ? '' : ' <span class="pill">off</span>') + '</td><td>' + esc(m.category) + '</td><td class="r">' + money(m.price) + '</td><td class="actions">' + (mg ? '<button class="sm sec" data-act="editmenu" data-id="' + m.id + '">Edit</button>' : '') + '</td></tr>'; }), 'No menu items yet.') + '</div>' +
        '<div><div class="card"><h3>Tables' + (mg ? ' <button class="sm gold" data-act="newtable" style="float:right">+ Add</button>' : '') + '</h3>' + table(['Table', ''], menu.tables.map(function (t) { return '<tr><td>' + esc(t.name) + (t.is_active ? '' : ' <span class="pill">off</span>') + '</td><td class="actions">' + (mg ? '<button class="sm sec" data-act="edittable" data-id="' + t.id + '">Edit</button>' : '') + '</td></tr>'; }), 'No tables yet.') + '</div>' +
        '<div class="card"><h3>Categories' + (mg ? ' <button class="sm gold" data-act="newcat" style="float:right">+ Add</button>' : '') + '</h3>' + table(['Category'], menu.categories.map(function (c) { return '<tr><td>' + esc(c.name) + '</td></tr>'; }), 'No categories yet.') + '</div></div></div>';
      v.innerHTML = '<div class="tabs"><button data-act="rtab" data-tab="orders" class="' + (tab === 'orders' ? 'on' : '') + '">Orders</button>' + (mg ? '<button data-act="rtab" data-tab="setup" class="' + (tab === 'setup' ? 'on' : '') + '">Menu &amp; setup</button>' : '') + '</div>' + (tab === 'setup' && mg ? setupHtml : ordersHtml);
      var of = v.querySelector('#of'); if (of) of.onchange = function () { S.rfilter = of.value; refresh(); };
    });
  };

  function simpleModal(title, fieldsHtml, action, extra, getMore) {
    modal(title, '<form id="sf">' + fieldsHtml + '<div class="actions"><button type="submit">Save</button></div></form>', function (m) {
      m.el.querySelector('#sf').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); Object.assign(d, extra || {}); busy(e.target.querySelector('button'), function () { return API.call(action, d).then(function () { m.close(); toast('Saved.'); refresh(); }); }); };
    });
  }
  function menuModal(it) {
    it = it || {}; var cats = S.menuCache.categories;
    simpleModal(it.id ? 'Edit menu item' : 'Add menu item', '<div class="f"><label>Name *</label><input name="name" required value="' + esc(it.name) + '"></div><div class="row"><div class="f"><label>Price *</label><input name="price" type="number" step="0.01" min="0.01" required value="' + esc(it.price) + '"></div><div class="f"><label>Category</label><select name="category_id"><option value="">—</option>' + opts(cats, 'id', function (c) { return c.name; }, it.category_id) + '</select></div></div><label class="chk f"><input type="checkbox" name="is_active"' + (it.id && !it.is_active ? '' : ' checked') + '> On the menu</label>', 'restaurant.menuSave', it.id ? { id: it.id } : {});
  }

  function newOrderModal() {
    Promise.all([API.call('frontdesk.inHouse')]).then(function (r) {
      var inh = r[0], tables = S.menuCache.tables.filter(function (t) { return t.is_active; });
      modal('New restaurant order', '<form id="nof"><div class="f"><label>Order for</label><select name="settlement_type" id="st"><option value="walk_in">Walk-in guest (pay now)</option><option value="room_charge">In-house guest (charge to room)</option></select></div><div class="f" id="tbl"><label>Table</label><select name="table_id"><option value="">—</option>' + opts(tables, 'id', function (t) { return t.name; }) + '</select></div><div class="f" id="rm" style="display:none"><label>Room</label><select name="folio_id">' + (inh.length ? opts(inh, 'folio_id', function (s) { return 'Room ' + s.room_number + ' — ' + s.guest_name; }) : '<option value="">No guests in house</option>') + '</select></div><div class="actions"><button type="submit">Start order</button></div></form>', function (m) {
        var st = m.el.querySelector('#st'); st.onchange = function () { var rc = st.value === 'room_charge'; m.el.querySelector('#rm').style.display = rc ? '' : 'none'; m.el.querySelector('#tbl').style.display = rc ? 'none' : ''; };
        m.el.querySelector('#nof').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); if (d.settlement_type === 'room_charge') d.table_id = ''; busy(e.target.querySelector('button'), function () { return API.call('restaurant.create', d).then(function (o) { m.close(); refresh(); orderModal(o.id); }); }); };
      });
    }).catch(fail);
  }

  function orderModal(id, existing) {
    API.call('restaurant.order', { order_id: Number(id) }).then(function (o) {
      var m = existing || modal('Order', ''), tx = can('restaurant.transact'), editable = o.status === 'open' && tx;
      var menu = S.menuCache.items.filter(function (i) { return i.is_active; });
      var html = '<div class="kv"><b>Order</b><span>' + esc(o.order_number) + ' ' + pill(o.status) + '</span><b>For</b><span>' + esc(o.room_number ? 'Room ' + o.room_number + ' — ' + o.guest_name : (o.table_name || 'Walk-in')) + '</span></div>' +
        table(['Item', '>Qty', '>Price', '>Amount', ''], o.items.map(function (i) { return '<tr><td>' + esc(i.description) + '</td><td class="r">' + i.quantity + '</td><td class="r">' + money(i.unit_price) + '</td><td class="r">' + money(i.amount) + '</td><td class="actions">' + (editable ? '<button class="sm danger" data-rm="' + i.id + '">×</button>' : '') + '</td></tr>'; }), 'No items yet.') +
        '<div class="kv" style="margin-top:8px"><b>Total</b><span class="total">' + money(o.total) + '</span></div>';
      if (editable) {
        html += '<form id="af" class="row" style="margin-top:12px;align-items:flex-end"><div class="f" style="flex:2 1 200px"><label>Add from menu</label><select name="menu_item_id"><option value="">— one-off item —</option>' + opts(menu, 'id', function (i) { return i.name + ' · ' + money(i.price); }) + '</select></div><div class="f" style="flex:0 1 80px"><label>Qty</label><input name="quantity" type="number" min="1" value="1"></div><div class="f" style="flex:0 0 auto"><button type="submit">Add</button></div></form>' +
          '<div class="row" id="oneoff" style="display:none"><div class="f" style="flex:2 1 200px"><label>One-off description</label><input id="od"></div><div class="f"><label>Price</label><input id="op" type="number" step="0.01" min="0.01"></div></div>';
      }
      var btns = '';
      if (tx && o.status === 'open') btns += '<button data-o="restaurant.send">Send to kitchen</button>';
      if (tx && o.status === 'sent_to_kitchen') btns += '<button data-o="restaurant.served">Mark served</button>';
      if (tx && ['open', 'sent_to_kitchen', 'served'].indexOf(o.status) !== -1 && o.items.length) {
        btns += (o.settlement_type === 'walk_in' ? '<select id="pm" style="width:auto">' + opts(S.methods, 'id', function (x) { return x.name; }) + '</select>' : '') + '<button class="gold" data-o="restaurant.settle">' + (o.settlement_type === 'walk_in' ? 'Take payment' : 'Charge to room') + '</button>';
      }
      if (tx && ['open', 'sent_to_kitchen', 'served'].indexOf(o.status) !== -1) btns += '<button class="danger" data-o="restaurant.cancel">Cancel order</button>';
      if (o.status === 'settled') btns += '<button class="sec" data-print="1">Print receipts (2 copies)</button>';
      html += '<div class="actions" style="margin-top:14px">' + btns + '</div>';
      m.setHtml(html);
      var again = function () { orderModal(id, m); refresh(); };
      var af = m.el.querySelector('#af');
      if (af) {
        var sel = af.querySelector('[name=menu_item_id]'), oo = m.el.querySelector('#oneoff'); sel.onchange = function () { oo.style.display = sel.value ? 'none' : ''; }; oo.style.display = sel.value ? 'none' : '';
        af.onsubmit = function (e) { e.preventDefault(); var d = { order_id: o.id, menu_item_id: sel.value ? Number(sel.value) : null, quantity: af.quantity.value, description: m.el.querySelector('#od').value, unit_price: m.el.querySelector('#op').value }; busy(af.querySelector('button'), function () { return API.call('restaurant.addItem', d).then(again); }); };
      }
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-rm]'), function (b) { b.onclick = function () { busy(b, function () { return API.call('restaurant.removeItem', { item_id: Number(b.getAttribute('data-rm')) }).then(again); }); }; });
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-o]'), function (b) {
        b.onclick = function () {
          var act = b.getAttribute('data-o'), args = { order_id: o.id };
          if (act === 'restaurant.settle' && o.settlement_type === 'walk_in') args.payment_method_id = Number(m.el.querySelector('#pm').value);
          if (act === 'restaurant.cancel') { var r = prompt('Reason for cancelling this order:'); if (!r) return; args.reason = r; }
          busy(b, function () { return API.call(act, args).then(function () { if (act === 'restaurant.settle') toast('Order settled.'); again(); }); });
        };
      });
      var pr = m.el.querySelector('[data-print]'); if (pr) pr.onclick = function () { API.call('receipt.outlet', { order_id: o.id }).then(showReceipt).catch(fail); };
    }).catch(fail);
  }


  // ----- bar, gift shop, business centre, salon, spa -----
  var OUTLET_LABELS = { bar: 'Bar', gift_shop: 'Gift Shop', business_centre: 'Business Centre', salon: 'Salon', spa: 'Spa', laundry: 'Laundry', gym: 'Gym', pool: 'Pool', parking: 'Parking', transport: 'Transport' };
  S.cart = {};
  VIEWS.outlets = function (v) {
    var keys = Object.keys(OUTLET_LABELS).filter(function (k) { return can(k + '.view') && !modOff('outlet:' + k); });
    var cur = keys.indexOf(S.outlet) !== -1 ? S.outlet : keys[0], tx = can(cur + '.transact'), mg = can(cur + '.manage');
    var cart = S.cart[cur] = S.cart[cur] || [];
    return Promise.all([API.call('outlet.list', { outlet: cur }), tx ? API.call('frontdesk.inHouse').catch(function () { return []; }) : Promise.resolve([])]).then(function (r) {
      var d = r[0], inh = r[1], items = d.items.filter(function (i) { return i.is_active; }); S.outletItems = d.items;
      var total = cart.reduce(function (t, l) { return t + l.quantity * l.unit_price; }, 0);
      var sale = tx ? '<div class="card"><h3>New sale</h3><form id="addl" class="row" style="align-items:flex-end"><div class="f" style="flex:2 1 200px"><label>Item</label><select name="item_id"><option value="">— one-off item —</option>' + opts(items, 'id', function (i) { return i.name + ' · ' + money(i.price); }) + '</select></div><div class="f" style="flex:0 1 80px"><label>Qty</label><input name="quantity" type="number" min="1" value="1"></div><div class="f" id="oo1" style="display:none"><label>Description</label><input name="description"></div><div class="f" id="oo2" style="display:none;flex:0 1 110px"><label>Price</label><input name="unit_price" type="number" step="0.01" min="0.01"></div><div class="f" style="flex:0 0 auto"><button type="submit" class="sec">Add</button></div></form>' +
        table(['Item', '>Qty', '>Price', '>Amount', ''], cart.map(function (l, i) { return '<tr><td>' + esc(l.description) + '</td><td class="r">' + l.quantity + '</td><td class="r">' + money(l.unit_price) + '</td><td class="r">' + money(l.quantity * l.unit_price) + '</td><td class="actions"><button class="sm danger" data-cx="' + i + '">×</button></td></tr>'; }), 'Cart is empty.') +
        '<form id="sellf" style="margin-top:12px"><div class="row"><div class="f"><label>Settlement</label><select name="settlement_type" id="stt"><option value="walk_in">Pay now</option><option value="room_charge">Charge to in-house guest\'s room</option></select></div><div class="f" id="pmw"><label>Payment method</label><select name="payment_method_id">' + opts(S.methods, 'id', function (m) { return m.name; }) + '</select></div><div class="f" id="rmw" style="display:none"><label>Room</label><select name="folio_id">' + (inh.length ? opts(inh, 'folio_id', function (s2) { return 'Room ' + s2.room_number + ' — ' + s2.guest_name; }) : '<option value="">No guests in house</option>') + '</select></div><div class="f"><label>Customer (optional)</label><input name="customer_name"></div></div><div class="actions"><span class="total" style="margin-right:auto">Total ' + money(total) + '</span><button type="submit"' + (cart.length ? '' : ' disabled') + '>Complete sale &amp; print receipt</button></div></form></div>' : '';
      var hist = '<div class="card"><h3>Recent sales</h3>' + table(['Sale', 'When', 'Customer / room', 'Settlement', '>Total', ''], d.sales.map(function (x) { return '<tr><td>' + esc(x.sale_number) + '</td><td class="muted">' + esc((x.settled_at || '').substr(0, 16)) + '</td><td>' + esc(x.room_number ? 'Room ' + x.room_number + ' · ' + x.guest_name : x.guest_name || '—') + '</td><td>' + (x.settlement_type === 'room_charge' ? 'Room charge' : esc(x.method_name)) + '</td><td class="r">' + money(x.amount_paid) + '</td><td class="actions"><button class="sm sec" data-act="orcpt" data-id="' + x.id + '">Receipt</button></td></tr>'; }), 'No sales yet.') + '</div>';
      var list = '<div class="card"><h3>Price list' + (mg ? ' <button class="sm gold" data-act="newoitem" style="float:right">+ Add item</button>' : '') + '</h3>' + table(['Item', '>Price', ''], d.items.map(function (i) { return '<tr><td>' + esc(i.name) + (i.is_active ? '' : ' <span class="pill">off</span>') + '</td><td class="r">' + money(i.price) + '</td><td class="actions">' + (mg ? '<button class="sm sec" data-act="editoitem" data-id="' + i.id + '">Edit</button>' : '') + '</td></tr>'; }), 'No items yet.') + '</div>';
      v.innerHTML = '<div class="tabs">' + keys.map(function (k) { return '<button data-act="outlettab" data-o="' + k + '" class="' + (k === cur ? 'on' : '') + '">' + OUTLET_LABELS[k] + '</button>'; }).join('') + '</div>' + sale + '<div class="grid g2">' + hist + list + '</div>';
      S.outlet = cur;
      var addl = v.querySelector('#addl');
      if (addl) {
        var sel = addl.querySelector('[name=item_id]'), toggle = function () { var one = !sel.value; v.querySelector('#oo1').style.display = v.querySelector('#oo2').style.display = one ? '' : 'none'; }; sel.onchange = toggle; toggle();
        addl.onsubmit = function (e) {
          e.preventDefault(); var f = e.target, q = Number(f.quantity.value);
          if (!(q >= 1) || Math.floor(q) !== q) return toast('Quantity must be a whole number of at least 1.', true);
          if (sel.value) { var it = items.filter(function (x) { return String(x.id) === sel.value; })[0]; cart.push({ item_id: it.id, description: it.name, quantity: q, unit_price: it.price }); }
          else { var pr = Number(f.unit_price.value); if (!f.description.value.trim() || !(pr > 0)) return toast('Enter a description and a price above zero.', true); cart.push({ description: f.description.value.trim(), quantity: q, unit_price: pr }); }
          refresh();
        };
        Array.prototype.forEach.call(v.querySelectorAll('[data-cx]'), function (b) { b.onclick = function () { cart.splice(Number(b.getAttribute('data-cx')), 1); refresh(); }; });
        var stt = v.querySelector('#stt'); stt.onchange = function () { var rc = stt.value === 'room_charge'; v.querySelector('#rmw').style.display = rc ? '' : 'none'; v.querySelector('#pmw').style.display = rc ? 'none' : ''; };
        v.querySelector('#sellf').onsubmit = function (e) {
          e.preventDefault(); var d2 = formData(e.target);
          var payload = { outlet: cur, settlement_type: d2.settlement_type, payment_method_id: d2.settlement_type === 'walk_in' ? Number(d2.payment_method_id) : null, folio_id: d2.settlement_type === 'room_charge' ? Number(d2.folio_id) : null, customer_name: d2.customer_name, items: cart.map(function (l) { return { item_id: l.item_id || null, description: l.description, quantity: l.quantity, unit_price: l.unit_price }; }) };
          busy(e.target.querySelector('button[type=submit]'), function () { return API.call('outlet.sell', payload).then(function (res) { S.cart[cur] = []; if (res.queued) { refresh(); return; } toast('Sale ' + res.sale_number + ' completed.'); refresh(); return API.call('outlet.receipt', { outlet: cur, sale_id: res.id }).then(showReceipt); }); });
        };
      }
    });
  };
  function outletItemModal(it) {
    it = it || {}; var o = S.outlet;
    simpleModal(it.id ? 'Edit item' : 'Add item', '<div class="f"><label>Name *</label><input name="name" required value="' + esc(it.name) + '"></div><div class="f"><label>Price *</label><input name="price" type="number" step="0.01" min="0.01" required value="' + esc(it.price) + '"></div><label class="chk f"><input type="checkbox" name="is_active"' + (it.id && !it.is_active ? '' : ' checked') + '> Available</label>', 'outlet.itemSave', Object.assign({ outlet: o }, it.id ? { id: it.id } : {}));
  }


  // ----- inventory -----
  var STK = { out: 'Out of stock', low: 'Low', ok: 'In stock' };
  VIEWS.inventory = function (v) {
    var tab = S.invTab || 'stock', flt = S.invFilter || 'all', q = (S.invQ || '').toLowerCase(), tx = can('inventory.transact'), mg = can('inventory.manage');
    return API.call('inventory.data').then(function (d) {
      S.inv = d; var cnt = { all: d.items.length, out: 0, low: 0, ok: 0 }; d.items.forEach(function (i) { if (i.is_active) cnt[i.status]++; else cnt.all--; });
      var list = d.items.filter(function (i) { return i.is_active && (flt === 'all' || i.status === flt) && (!q || i.name.toLowerCase().indexOf(q) !== -1 || i.store.toLowerCase().indexOf(q) !== -1); });
      function meter(i) { var top = i.reorder_level > 0 ? i.reorder_level * 2 : Math.max(i.quantity, 1); var pct = Math.max(0, Math.min(100, i.quantity / top * 100)); return '<div class="stk-meter"><div class="stk-fill ' + i.status + '" style="width:' + pct + '%"></div>' + (i.reorder_level > 0 ? '<span class="stk-tick"></span>' : '') + '</div>'; }
      var stock = '<div class="grid g4" style="margin-bottom:14px">' + [['all', 'All items', cnt.all], ['out', 'Out of stock', cnt.out], ['low', 'Low stock', cnt.low], ['ok', 'In stock', cnt.ok]].map(function (c) {
        return '<button class="stk-card ' + c[0] + (flt === c[0] ? ' on' : '') + '" data-act="invfilter" data-f="' + c[0] + '"><b>' + c[2] + '</b><span>' + c[1] + '</span></button>'; }).join('') + '</div>' +
        '<div class="card"><form id="iq" class="row" style="align-items:flex-end"><div class="f"><label>Search</label><input name="q" value="' + esc(S.invQ || '') + '" placeholder="Item or store"></div></form>' +
        table(['Item', 'Store', '>On hand', 'Level', 'Status', ''], list.map(function (i) {
          return '<tr><td><b>' + esc(i.name) + '</b></td><td>' + esc(i.store) + '</td><td class="r">' + i.quantity + ' <span class="muted">' + esc(i.unit) + '</span></td><td style="min-width:120px">' + meter(i) + '<div class="muted" style="font-size:.72rem">reorder at ' + i.reorder_level + '</div></td><td><span class="stk-pill ' + i.status + '">' + STK[i.status] + '</span></td><td class="actions">' + (tx ? '<button class="sm sec" data-act="invmove" data-id="' + i.id + '">Move stock</button>' : '') + '</td></tr>'; }), 'No items match.') + '</div>';
      var moves = '<div class="card">' + table(['When', 'Item', 'Type', '>Change', '>Balance', 'By', 'Note'], d.movements.map(function (m) {
        return '<tr><td class="muted" style="white-space:nowrap">' + esc(m.created_at.substr(0, 16)) + '</td><td>' + esc(m.item) + '</td><td>' + esc(m.movement_type) + '</td><td class="r ' + (m.quantity < 0 ? 'neg' : '') + '">' + (m.quantity > 0 ? '+' : '') + m.quantity + '</td><td class="r">' + m.balance_after + '</td><td>' + esc(m.by) + '</td><td class="muted">' + esc(m.notes) + '</td></tr>'; }), 'No stock movements yet.') + '</div>';
      var setup = (mg ? '<div class="card"><button class="sm gold" data-act="stklinks">Link menu items to stock</button> <span class="muted">Selling a linked item takes stock off automatically.</span></div>' : '') + '<div class="grid g2"><div class="card"><h3>Stores <button class="sm gold" data-act="invnew" data-k="store" style="float:right">+ Add</button></h3>' + table(['Store', ''], d.stores.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="actions"><button class="sm sec" data-act="invedit" data-k="store" data-id="' + x.id + '">Edit</button></td></tr>'; }), 'No stores yet.') + '</div>' +
        '<div class="card"><h3>Units <button class="sm gold" data-act="invnew" data-k="unit" style="float:right">+ Add</button></h3>' + table(['Unit', ''], d.units.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="actions"><button class="sm sec" data-act="invedit" data-k="unit" data-id="' + x.id + '">Edit</button></td></tr>'; }), 'No units yet.') + '</div></div>' +
        '<div class="card"><h3>Items <button class="sm gold" data-act="invitem" style="float:right">+ Add item</button></h3>' + table(['Item', 'Store', 'Unit', '>Reorder level', ''], d.items.map(function (i) { return '<tr><td>' + esc(i.name) + (i.is_active ? '' : ' <span class="pill">off</span>') + '</td><td>' + esc(i.store) + '</td><td>' + esc(i.unit) + '</td><td class="r">' + i.reorder_level + '</td><td class="actions"><button class="sm sec" data-act="invitem" data-id="' + i.id + '">Edit</button></td></tr>'; }), 'No items yet.') + '</div>';
      v.innerHTML = '<div class="tabs"><button data-act="invtab" data-t="stock" class="' + (tab === 'stock' ? 'on' : '') + '">Stock levels</button><button data-act="invtab" data-t="moves" class="' + (tab === 'moves' ? 'on' : '') + '">Movements</button>' + (mg ? '<button data-act="invtab" data-t="setup" class="' + (tab === 'setup' ? 'on' : '') + '">Setup</button>' : '') + '</div>' + (tab === 'moves' ? moves : tab === 'setup' && mg ? setup : stock);
      var iq = v.querySelector('#iq'); if (iq) { iq.onsubmit = function (e) { e.preventDefault(); S.invQ = e.target.q.value; refresh(); }; }
    });
  };
  function invMoveModal(id) {
    var it = S.inv.items.filter(function (i) { return String(i.id) === String(id); })[0];
    modal('Move stock — ' + it.name, '<p class="muted">On hand: <b>' + it.quantity + ' ' + esc(it.unit) + '</b> (' + esc(it.store) + ')</p><form id="mv"><div class="row"><div class="f"><label>Action</label><select name="movement_type" id="mt"><option value="in">Receive stock (in)</option><option value="out">Issue / use (out)</option><option value="adjust">Stock-take (set counted quantity)</option></select></div><div class="f"><label id="ql">Quantity</label><input name="quantity" type="number" step="0.001" min="0" required></div></div><div class="f"><label>Reference (optional)</label><input name="reference" placeholder="e.g. delivery note"></div><div class="f"><label id="nl">Note</label><input name="notes"></div><div class="actions"><button type="submit">Save</button></div></form>', function (m) {
      var mt = m.el.querySelector('#mt'); mt.onchange = function () { m.el.querySelector('#ql').textContent = mt.value === 'adjust' ? 'Counted quantity' : 'Quantity'; m.el.querySelector('#nl').textContent = mt.value === 'adjust' ? 'Reason (required)' : 'Note'; };
      m.el.querySelector('#mv').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); d.item_id = it.id; busy(e.target.querySelector('button'), function () { return API.call('inventory.move', d).then(function () { m.close(); toast('Stock updated.'); refresh(); }); }); };
    });
  }
  function invItemModal(id) {
    var it = id ? S.inv.items.filter(function (i) { return String(i.id) === String(id); })[0] : {};
    if (!S.inv.stores.length || !S.inv.units.length) return toast('Add at least one store and one unit first.', true);
    simpleModal(it.id ? 'Edit stock item' : 'Add stock item', '<div class="f"><label>Name *</label><input name="name" required value="' + esc(it.name) + '"></div><div class="row"><div class="f"><label>Store *</label><select name="store_id">' + opts(S.inv.stores, 'id', function (x) { return x.name; }, it.store_id) + '</select></div><div class="f"><label>Unit *</label><select name="unit_id">' + opts(S.inv.units, 'id', function (x) { return x.name; }, it.unit_id) + '</select></div></div><div class="f"><label>Reorder level (alert when stock is at or below this)</label><input name="reorder_level" type="number" step="0.001" min="0" value="' + esc(it.reorder_level || 0) + '"></div><label class="chk f"><input type="checkbox" name="is_active"' + (it.id && !it.is_active ? '' : ' checked') + '> In use</label>' + (it.id ? '' : '<p class="muted">New items start at 0. Use <b>Move stock</b> to receive the opening quantity.</p>'), 'inventory.itemSave', it.id ? { id: it.id } : {});
  }

  // ----- expenses -----
  VIEWS.expenses = function (v) {
    var from = S.expFrom || today().slice(0, 8) + '01', to = S.expTo || today();
    return API.call('expenses.list', { from: from, to: to }).then(function (d) {
      S.expCats = d.categories;
      v.innerHTML = '<div class="card"><form id="ef" class="row" style="align-items:flex-end"><div class="f"><label>From</label><input type="date" name="from" value="' + from + '"></div><div class="f"><label>To</label><input type="date" name="to" value="' + to + '"></div><div class="f" style="flex:0 0 auto"><button type="submit" class="sec">Show</button></div>' +
        (can('expenses.create') ? '<div class="f" style="flex:0 0 auto"><button type="button" class="gold" data-act="newexp">+ Record expense</button></div><div class="f" style="flex:0 0 auto"><button type="button" class="sec" data-act="newexpcat">+ Category</button></div>' : '') + '</form>' +
        (can('settings.manage') ? '<label class="chk"><input type="checkbox" id="exppol"' + (d.need_approval ? ' checked' : '') + '> New expenses need approval, then payment (otherwise they are recorded as paid at once)</label>' : '') + (d.payables_count ? '<div class="kv" style="margin-bottom:6px"><b>Waiting to be paid (' + d.payables_count + ')</b><span class="total">' + money(d.payables_total) + '</span></div>' : '') + '<div class="kv" style="margin-bottom:10px"><b>Total paid (excluding voided)</b><span class="total">' + money(d.total) + '</span></div>' +
        table(['Number', 'Date', 'Category', 'Payee', 'Description', '>Amount', 'Status', ''], d.expenses.map(function (e) {
          return '<tr><td>' + esc(e.expense_number) + '</td><td>' + esc(e.expense_date) + '</td><td>' + esc(e.category) + '</td><td>' + esc(e.payee) + '</td><td>' + esc(e.description) + '<div class="muted">' + esc(e.method_name) + '</div></td><td class="r">' + money(e.amount) + '</td><td>' + (e.status === 'void' || e.status === 'rejected' ? '<span class="pill bad" title="' + esc(e.void_reason) + '">' + e.status + '</span>' : e.status === 'paid' ? '<span class="pill ok">paid</span>' : '<span class="pill warn">' + e.status + '</span>') + '</td><td class="actions">' + (e.status === 'pending' && can('expenses.approve') ? '<button class="sm" data-act="expok" data-id="' + e.id + '">Approve</button> <button class="sm danger" data-act="expno" data-id="' + e.id + '">Reject</button>' : '') + (e.status === 'approved' && can('expenses.approve') ? '<button class="sm gold" data-act="exppay" data-id="' + e.id + '">Mark paid</button> ' : '') + ((e.status === 'paid' || e.status === 'approved') && can('expenses.void') ? '<button class="sm danger" data-act="voidexp" data-id="' + e.id + '">Void</button>' : '') + '</td></tr>'; }), 'No expenses in this period.') + '</div>';
      S.expNeed = d.need_approval; var ep = v.querySelector('#exppol'); if (ep) ep.onchange = function () { API.call('expenses.setPolicy', { expenses_need_approval: ep.checked }).then(function () { toast(ep.checked ? 'Expenses now need approval.' : 'Expenses are recorded as paid again.'); refresh(); }).catch(function (e) { ep.checked = !ep.checked; fail(e); }); };
      v.querySelector('#ef').onsubmit = function (e) { e.preventDefault(); S.expFrom = e.target.from.value; S.expTo = e.target.to.value; refresh(); };
    });
  };

  // ----- reports -----
  function periodReport(v) {
    var from = S.repFrom || addDays(today(), -29), to = S.repTo || today();
    v.innerHTML = '<div class="card"><form id="rp" class="row" style="align-items:flex-end"><div class="f"><label>From</label><input type="date" name="from" value="' + from + '"></div><div class="f"><label>To</label><input type="date" name="to" value="' + to + '"></div><div class="f" style="flex:0 0 auto"><button type="submit">Run report</button></div><div class="f" style="flex:0 0 auto"><button type="button" class="sec" id="pr">Print</button></div></form></div><div id="rout"></div>';
    v.querySelector('#pr').onclick = function () { window.print(); };
    function run() {
      return API.call('reports.get', { from: from, to: to }).then(function (r) {
        function kv(o) { return Object.keys(o).sort().map(function (k) { return '<tr><td>' + esc(k.replace(/_/g, ' ')) + '</td><td class="r">' + money(o[k]) + '</td></tr>'; }); }
        v.querySelector('#rout').innerHTML = '<div class="grid g2"><div class="card"><h3>Payments received — ' + money(r.payments_total) + '</h3>' + table(['Method', '>Net amount'], kv(r.payments_by_method), 'No payments in this period.') + '</div>' +
          '<div class="card"><h3>Charges posted — ' + money(r.charges_total) + '</h3>' + table(['Service', '>Amount'], kv(r.charges_by_service), 'No charges in this period.') + '</div></div>' +
          '<div class="card"><h3>Check-ins per room — ' + r.checkins_total + ' total</h3>' + table(['Room', '>Check-ins'], r.checkins_per_room.map(function (x) { return '<tr><td>' + esc(x.room_number) + '</td><td class="r">' + x.checkins + '</td></tr>'; }), 'No rooms.') + '</div>';
      });
    }
    v.querySelector('#rp').onsubmit = function (e) { e.preventDefault(); from = e.target.from.value; to = e.target.to.value; S.repFrom = from; S.repTo = to; run().catch(fail); };
    return run();
  }
  VIEWS.reports = function (v) {
    var tab = S.repTab || 'period';
    v.innerHTML = '<div class="tabs"><button data-act="reptab" data-tab="period" class="' + (tab === 'period' ? 'on' : '') + '">Period report</button><button data-act="reptab" data-tab="monthly" class="' + (tab === 'monthly' ? 'on' : '') + '">Monthly financial report</button></div><div id="rt"></div>';
    return (tab === 'monthly' ? monthlyReport : periodReport)(v.querySelector('#rt'));
  };
  function monthlyReport(v) {
    var month = S.repMonth || today().slice(0, 7);
    v.innerHTML = '<div class="card"><form id="mf" class="row" style="align-items:flex-end"><div class="f"><label>Month</label><input type="month" name="month" value="' + month + '" required></div><div class="f" style="flex:0 0 auto"><button type="submit">Show</button></div><div class="f" style="flex:0 0 auto"><button type="button" class="sec" id="mp">Print</button></div></form></div><div id="mout"></div>';
    v.querySelector('#mp').onclick = function () { window.print(); };
    function run() {
      return API.call('reports.monthly', { month: month }).then(function (r) {
        var c = r.current, p = r.previous;
        function delta(a, b) { var d = round(a - b); return '<td class="r ' + (d < 0 ? 'neg' : '') + '">' + (d > 0 ? '+' : '') + money(d) + '</td>'; }
        function round(n) { return Math.round(n * 100) / 100; }
        function sum(o) { return Object.keys(o || {}).reduce(function (t, k) { return t + o[k]; }, 0); }
        var rows = [['Payments received', c.payments_total, p.payments_total], ['Charges posted', c.charges_total, p.charges_total], ['Room revenue', c.room_revenue, p.room_revenue], ['Restaurant walk-in sales', c.restaurant_walkin_sales, p.restaurant_walkin_sales], ['Average room rate', c.average_rate, p.average_rate], ['Expenses (not voided)', c.expenses_total, p.expenses_total], ['Cash in less expenses', c.payments_total + sum(c.outlet_walkin_sales) + c.restaurant_walkin_sales - c.expenses_total, p.payments_total + sum(p.outlet_walkin_sales) + p.restaurant_walkin_sales - p.expenses_total]].map(function (x) { return '<tr><td>' + x[0] + '</td><td class="r">' + money(x[1]) + '</td><td class="r">' + money(x[2]) + '</td>' + delta(x[1], x[2]) + '</tr>'; });
        rows.push('<tr><td>Room nights sold</td><td class="r">' + c.room_nights + '</td><td class="r">' + p.room_nights + '</td><td class="r">' + (c.room_nights - p.room_nights) + '</td></tr>');
        rows.push('<tr><td>Check-ins</td><td class="r">' + c.checkins_total + '</td><td class="r">' + p.checkins_total + '</td><td class="r">' + (c.checkins_total - p.checkins_total) + '</td></tr>');
        var map = {}; p.checkins_per_room.forEach(function (x) { map[x.room_number] = x.checkins; });
        var rooms = c.checkins_per_room.map(function (x) { var pv = map[x.room_number] || 0; return '<tr><td>' + esc(x.room_number) + '</td><td class="r">' + x.checkins + '</td><td class="r">' + pv + '</td><td class="r">' + (x.checkins - pv) + '</td></tr>'; });
        function kv(o) { return Object.keys(o).sort().map(function (k) { return '<tr><td>' + esc(k.replace(/_/g, ' ')) + '</td><td class="r">' + money(o[k]) + '</td></tr>'; }); }
        v.querySelector('#mout').innerHTML = '<div class="card"><h3>' + esc(S.hotel.name) + ' — monthly financial report, ' + esc(r.month) + ' <span class="muted">(compared with ' + esc(r.previous_month) + ')</span></h3>' + table(['Measure', '>' + r.month, '>' + r.previous_month, '>Change'], rows) + '</div>' +
          '<div class="grid g2"><div class="card"><h3>Payments by method</h3>' + table(['Method', '>Net amount'], kv(c.payments_by_method), 'None.') + '</div><div class="card"><h3>Charges by service</h3>' + table(['Service', '>Amount'], kv(c.charges_by_service), 'None.') + '</div></div>' +
          '<div class="grid g2"><div class="card"><h3>Walk-in sales by outlet</h3>' + table(['Outlet', '>Amount'], kv(c.outlet_walkin_sales), 'None.') + '</div><div class="card"><h3>Expenses by category</h3>' + table(['Category', '>Amount'], kv(c.expenses_by_category), 'None.') + '</div></div>' +
          '<div class="card"><h3>Check-ins per room</h3>' + table(['Room', '>' + r.month, '>' + r.previous_month, '>Change'], rooms, 'No rooms.') + '</div>' + footerHtml(r.generated_at);
      });
    }
    v.querySelector('#mf').onsubmit = function (e) { e.preventDefault(); month = e.target.month.value; S.repMonth = month; run().catch(fail); };
    return run();
  }

  // ----- receipts / invoice (print) -----
  function footerHtml(when, who) { return '<div class="docfoot">Generated by <b>SmartGuest</b> · ' + esc(when || new Date().toLocaleString()) + (who ? ' · ' + esc(who) : '') + '</div>'; }
  function showReceipt(d) {
    var h = d.hotel || S.hotel || {}, head = '<div class="rc-head">' + logoImg('rc-logo') + '<b>' + esc(h.name) + '</b><div class="muted">' + esc([h.address, h.phone].filter(Boolean).join(' · ')) + '</div></div>', sheets;
    if (d.kind === 'restaurant') {
      var o = d.order;
      sheets = d.copies.map(function (copy) {
        return '<div class="sheet">' + head + '<div class="copylabel">' + esc(copy) + '</div><div class="kv"><b>Receipt</b><span>' + esc(o.order_number) + '</span><b>Date</b><span>' + esc((o.settled_at || '').substr(0, 16)) + '</span>' + (o.table_name ? '<b>Table</b><span>' + esc(o.table_name) + '</span>' : '') + (o.room_number ? '<b>Room</b><span>' + esc(o.room_number) + ' — ' + esc(o.guest_name) + '</span>' : '') + '<b>Served by</b><span>' + esc(d.served_by) + '</span></div>' +
          table(['Item', '>Qty', '>Price', '>Amount'], o.items.map(function (i) { return '<tr><td>' + esc(i.description) + '</td><td class="r">' + i.quantity + '</td><td class="r">' + money(i.unit_price) + '</td><td class="r">' + money(i.amount) + '</td></tr>'; })) +
          '<div class="kv" style="margin-top:8px"><b>Total</b><span class="total">' + money(o.total) + '</span><b>Settlement</b><span>' + esc(o.method_name) + '</span></div>' + footerHtml(d.printed_at, d.printed_by) + '</div>';
      }).join('');
    } else if (d.kind === 'outlet') {
      sheets = '<div class="sheet">' + head + '<h4 style="text-align:center">' + esc(d.outlet_label.toUpperCase()) + ' RECEIPT</h4><div class="kv"><b>Receipt</b><span>' + esc(d.sale.sale_number) + '</span><b>Date</b><span>' + esc((d.sale.settled_at || '').substr(0, 16)) + '</span>' + (d.guest_name ? '<b>Customer</b><span>' + esc(d.guest_name) + '</span>' : '') + (d.room ? '<b>Room</b><span>' + esc(d.room) + '</span>' : '') + '<b>Served by</b><span>' + esc(d.served_by) + '</span></div>' +
        table(['Item', '>Qty', '>Price', '>Amount'], d.items.map(function (i) { return '<tr><td>' + esc(i.description) + '</td><td class="r">' + i.quantity + '</td><td class="r">' + money(i.unit_price) + '</td><td class="r">' + money(i.amount) + '</td></tr>'; })) +
        '<div class="kv" style="margin-top:8px"><b>Total</b><span class="total">' + money(d.total) + '</span><b>Settlement</b><span>' + esc(d.method_name) + '</span></div>' + footerHtml(d.printed_at, d.printed_by) + '</div>';
    } else if (d.kind === 'payment') {
      var p = d.payment;
      sheets = d.copies.map(function (copy) {
        return '<div class="sheet">' + head + (copy ? '<div class="copylabel">' + esc(copy) + '</div>' : '') + '<h4 style="text-align:center">' + (p.amount < 0 ? 'REFUND / REVERSAL RECEIPT' : 'PAYMENT RECEIPT') + '</h4><div class="kv"><b>Receipt</b><span>' + esc(p.receipt_number) + '</span><b>Date</b><span>' + esc(p.received_at.substr(0, 16)) + '</span><b>Guest</b><span>' + esc(d.guest.full_name) + '</span><b>Room</b><span>' + esc(d.room) + '</span><b>Folio</b><span>' + esc(d.folio_number) + '</span><b>Method</b><span>' + esc(d.method_name) + '</span>' + (p.notes ? '<b>Note</b><span>' + esc(p.notes) + '</span>' : '') + '<b>Received by</b><span>' + esc(d.received_by) + '</span></div>' +
          '<div class="kv" style="margin-top:10px"><b>Amount</b><span class="total ' + (p.amount < 0 ? 'neg' : '') + '">' + money(p.amount) + '</span><b>Folio balance</b><span>' + money(d.balance) + '</span></div>' + footerHtml(d.printed_at, d.printed_by) + '</div>';
      }).join('');
    } else if (d.kind === 'simple') {
      sheets = '<div class="sheet">' + head + '<h4 style="text-align:center">' + esc(d.title) + '</h4><div class="kv"><b>Receipt</b><span>' + esc(d.number) + '</span><b>Date</b><span>' + esc(d.date) + '</span>' + d.lines.map(function (l) { return '<b>' + esc(l[0]) + '</b><span>' + esc(l[1]) + '</span>'; }).join('') + '</div><div class="kv" style="margin-top:10px"><b>Amount</b><span class="total ' + (d.amount < 0 ? 'neg' : '') + '">' + money(d.amount) + '</span><b>Settlement</b><span>' + esc(d.method_name) + '</span></div>' + footerHtml(d.printed_at, d.printed_by) + '</div>';
    } else if (d.kind === 'payslip') {
      var L = d.line, st = d.staff || {}, row = function (a, b) { return '<tr><td>' + esc(a) + '</td><td class="r">' + money(b) + '</td></tr>'; };
      sheets = '<div class="sheet">' + head + '<h4 style="text-align:center">PAYSLIP — ' + esc(d.run.period) + '</h4><div class="kv"><b>Employee</b><span>' + esc(L.staff_name) + '</span><b>Staff no.</b><span>' + esc(st.staff_number) + '</span><b>Job title</b><span>' + esc(L.job_title) + '</span>' + (st.ssnit_number ? '<b>SSNIT no.</b><span>' + esc(st.ssnit_number) + '</span>' : '') + (st.tin_number ? '<b>TIN</b><span>' + esc(st.tin_number) + '</span>' : '') + '</div>' +
        table(['Earnings', '>Amount'], [row('Basic salary', L.basic), row('Allowances', L.allowances), row('Bonus / overtime', L.bonus), '<tr><td><b>Gross pay</b></td><td class="r"><b>' + money(L.gross) + '</b></td></tr>']) +
        table(['Deductions', '>Amount'], [row('SSNIT (employee)', L.ssnit_employee), row('PAYE income tax', L.paye), row('Other deductions' + (L.deduction_note ? ' — ' + L.deduction_note : ''), L.other_deductions)]) +
        '<div class="kv" style="margin-top:8px"><b>Net pay</b><span class="total">' + money(L.net) + '</span><b>Employer SSNIT (not deducted)</b><span>' + money(L.ssnit_employer) + '</span></div>' + footerHtml(d.printed_at, d.printed_by) + '</div>';
    } else {
      var f = d.folio;
      sheets = '<div class="sheet">' + head + '<h4 style="text-align:center">INVOICE / GUEST STATEMENT</h4><div class="kv"><b>Folio</b><span>' + esc(f.folio.folio_number) + '</span><b>Guest</b><span>' + esc(f.guest.full_name) + '</span><b>Room</b><span>' + esc(f.room) + '</span><b>Check-in</b><span>' + esc(f.stay.checkin_at.substr(0, 16)) + '</span>' + (f.stay.checkout_at ? '<b>Check-out</b><span>' + esc(f.stay.checkout_at.substr(0, 16)) + '</span>' : '') + '</div>' +
        table(['Description', '>Qty', '>Amount'], f.items.map(function (i) { return '<tr><td>' + esc(i.description) + '</td><td class="r">' + i.quantity + '</td><td class="r">' + money(i.amount) + '</td></tr>'; }), 'No charges.') +
        '<h4 style="margin-top:12px">Payments</h4>' + table(['Receipt', 'Date', '>Amount'], f.payments.map(function (p) { return '<tr><td>' + esc(p.receipt_number) + '</td><td>' + esc(p.received_at.substr(0, 10)) + '</td><td class="r">' + money(p.amount) + '</td></tr>'; }), 'No payments.') +
        '<div class="kv" style="margin-top:10px"><b>Total charges</b><span>' + money(f.charges) + '</span><b>Total paid</b><span>' + money(f.paid) + '</span><b>Balance due</b><span class="total ' + (f.balance > 0 ? 'neg' : '') + '">' + money(f.balance) + '</span></div>' + footerHtml(d.printed_at, d.printed_by) + '</div>';
    }
    modal('Print preview', '<div class="actions noprint" style="margin-bottom:10px"><button data-doprint>Print</button></div><div class="sheets">' + sheets + '</div>', function (m) {
      m.el.querySelector('[data-doprint]').onclick = function () { window.print(); };
    });
  }

  VIEWS.users = function (v) {
    return Promise.all([API.call('users.list'), API.call('roles.list')]).then(function (r) {
      var users = r[0], roles = r[1]; S.roleCache = roles; S.userCache = users;
      v.innerHTML = '<div class="card"><h3>Users <button class="sm gold" data-act="newuser" style="float:right">+ Add user</button></h3>' + table(['Username', 'Name', 'Role', 'Status', 'Last sign-in', ''], users.map(function (u) {
        return '<tr><td>' + esc(u.username) + '</td><td>' + esc(u.full_name) + '</td><td>' + esc(u.role) + '</td><td>' + (u.is_active ? '<span class="pill ok">active</span>' : '<span class="pill bad">disabled</span>') + '</td><td class="muted">' + esc(u.last_login_at || '—') + '</td><td class="actions"><button class="sm sec" data-act="edituser" data-id="' + u.id + '">Edit</button><button class="sm sec" data-act="resetpw" data-id="' + u.id + '">Reset password</button></td></tr>'; }), 'No users.') + '</div>' +
        '<div class="card"><h3>Roles' + (can('roles.manage') ? ' <button class="sm gold" data-act="newrole" style="float:right">+ Add role</button>' : '') + '</h3>' + table(['Role', '>Permissions', ''], roles.map(function (x) {
          return '<tr><td>' + esc(x.name) + (x.is_system ? ' <span class="pill">system</span>' : '') + '</td><td class="r">' + x.permissions.length + '</td><td class="actions">' + (can('roles.manage') && !x.is_system ? '<button class="sm sec" data-act="editrole" data-id="' + x.id + '">Edit</button>' : '') + '</td></tr>'; }), 'No roles.') + '</div>';
    });
  };
  function userModal(u) {
    u = u || {};
    modal(u.id ? 'Edit user' : 'Add user', '<form id="uf"><div class="row"><div class="f"><label>Username *</label><input name="username" required value="' + esc(u.username) + '"></div><div class="f"><label>Full name *</label><input name="full_name" required value="' + esc(u.full_name) + '"></div></div><div class="row"><div class="f"><label>Role *</label><select name="role_id">' + opts(S.roleCache, 'id', function (r) { return r.name; }, u.role_id) + '</select></div><div class="f"><label>Phone</label><input name="phone" value="' + esc(u.phone) + '"></div></div>' +
      (u.id ? '<label class="chk f"><input type="checkbox" name="is_active"' + (u.is_active ? ' checked' : '') + '> Active (untick to sign this user out and block sign-in)</label>' : '<div class="f"><label>Password * (8+ characters, letters and numbers)</label><input name="password" type="password" required autocomplete="new-password"></div>') + '<div class="actions"><button type="submit">Save</button></div></form>', function (m) {
      m.el.querySelector('#uf').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); if (u.id) d.id = u.id; busy(e.target.querySelector('button'), function () { return API.call('users.save', d).then(function () { m.close(); toast('User saved.'); refresh(); }); }); };
    });
  }
  function roleModal(r) {
    r = r || { permissions: [] };
    API.call('permissions.list').then(function (perms) {
      modal(r.id ? 'Edit role' : 'Add role', '<form id="rlf"><div class="f"><label>Role name *</label><input name="name" required value="' + esc(r.name) + '"></div><div class="grid g2" style="gap:4px 18px">' + perms.map(function (p) { return '<label class="chk"><input type="checkbox" name="p_' + esc(p.code) + '"' + (r.permissions.indexOf(p.code) !== -1 ? ' checked' : '') + '> <span>' + esc(p.description) + '<br><small class="muted">' + esc(p.code) + '</small></span></label>'; }).join('') + '</div><div class="actions" style="margin-top:12px"><button type="submit">Save</button></div></form>', function (m) {
        m.el.querySelector('#rlf').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target), sel = Object.keys(d).filter(function (k) { return k.indexOf('p_') === 0 && d[k]; }).map(function (k) { return k.slice(2); }); busy(e.target.querySelector('button'), function () { return API.call('roles.save', { id: r.id, name: d.name, permissions: sel }).then(function () { m.close(); toast('Role saved.'); refresh(); }); }); };
      });
    }).catch(fail);
  }

  // ----- settings & audit -----
  VIEWS.settings = function (v) {
    var h = S.hotel, edit = can('settings.manage');
    v.innerHTML = (edit ? '<div class="card"><h3>Hotel</h3><form id="hf"><div class="row"><div class="f"><label>Hotel name *</label><input name="name" required value="' + esc(h.name) + '"></div><div class="f"><label>Currency symbol</label><input name="currency_symbol" value="' + esc(h.currency_symbol) + '"></div></div><div class="row"><div class="f"><label>Phone</label><input name="phone" value="' + esc(h.phone) + '"></div><div class="f"><label>Email</label><input name="email" value="' + esc(h.email) + '"></div></div><div class="f"><label>Address</label><input name="address" value="' + esc(h.address) + '"></div>' +
      '<div class="row"><label class="chk f"><input type="checkbox" name="tax_enabled"' + (h.tax_enabled ? ' checked' : '') + '> Add tax to room charges</label><div class="f"><label>Tax name</label><input name="tax_name" value="' + esc(h.tax_name) + '"></div><div class="f"><label>Tax rate %</label><input name="tax_rate" type="number" step="0.01" min="0" max="100" value="' + esc(h.tax_rate) + '"></div></div><div class="actions"><button type="submit">Save hotel</button></div></form></div>' : '') +
      (edit ? '<div class="card"><h3>Branding</h3><form id="bf"><div class="row"><div class="f"><label>Logo (PNG or JPEG, shown on sign-in, menu and receipts)</label><input type="file" id="blogo" accept="image/png,image/jpeg,image/webp"></div><div class="f" style="flex:0 0 140px"><div id="bprev" class="logo-prev">' + logoImg('rc-logo') + '</div></div></div><div class="row"><div class="f"><label>Main colour</label><input type="color" name="color" value="' + esc((S.brand && S.brand.color) || '#1d2740') + '"></div><div class="f"><label>Highlight colour</label><input type="color" name="accent" value="' + esc((S.brand && S.brand.accent) || '#b8913f') + '"></div><div class="f"><label>Tagline (sign-in page)</label><input name="tagline" maxlength="80" value="' + esc((S.brand && S.brand.tagline) || '') + '" placeholder="Hotel Management System"></div></div><div class="actions"><button type="submit">Save branding</button> <button type="button" class="sec" id="bclear">Remove logo and colours</button></div></form></div>' : '') +
      (edit ? '<div class="card"><h3>Modules</h3><p class="muted">Switch off what this hotel does not use. It disappears from the menu and cannot be used by anyone; nothing is deleted, and you can switch it back on at any time.</p><div id="modbox" class="muted">Loading...</div></div>' : '') +
      (edit ? '<div class="card"><h3>Database health</h3><p class="muted">Your data lives in the Google Sheet. Check it is tidy, release unused space, and make sure the nightly backup and clean-up are scheduled.</p><div class="actions"><button class="sm" data-act="shcheck">Check now</button> <button class="sm sec" data-act="shrepair">Repair sheets</button> <button class="sm sec" data-act="shclean">Run clean-up now</button> <button class="sm sec" data-act="shsched">Schedule nightly jobs</button></div><div id="shout" style="margin-top:10px"></div></div>' : '') +
      '<div class="card"><h3>Change my password</h3><form id="pw"><div class="row"><div class="f"><label>Current password</label><input type="password" name="current_password" required autocomplete="current-password"></div><div class="f"><label>New password</label><input type="password" name="new_password" required autocomplete="new-password"></div></div><div class="actions"><button type="submit">Change password</button></div></form></div>' +
      (API.inGas ? '' : '<div class="card"><h3>Server</h3><p class="muted" style="word-break:break-all">' + esc(API.getUrl()) + '</p><button class="sec sm" data-act="chgurl">Change server URL</button></div>');
    var mb = v.querySelector('#modbox'); if (mb) API.call('modules.list').then(function (list) {
      function row(m) { return '<label class="chk" style="display:block;margin:4px 0"><input type="checkbox" data-mod="' + esc(m.id) + '"' + (m.enabled ? ' checked' : '') + '> ' + esc(m.name) + '</label>'; }
      mb.className = ''; mb.innerHTML = list.filter(function (m) { return !m.group; }).map(row).join('') + '<h4 style="margin:10px 0 2px">Services &amp; Shops</h4>' + list.filter(function (m) { return m.group; }).map(row).join('');
      mb.onchange = function (e) { var cb = e.target; if (!cb.getAttribute('data-mod')) return; API.call('modules.set', { id: cb.getAttribute('data-mod'), enabled: cb.checked }).then(function (r) { S.off = r.off; toast(cb.checked ? 'Switched on.' : 'Switched off.'); var keep = document.querySelector('.main').scrollTop; render(); }).catch(function (er) { cb.checked = !cb.checked; fail(er); }); };
    }).catch(function () { mb.textContent = 'Could not load.'; });
    var bf = v.querySelector('#bf'); if (bf) {
      var newLogo;   // undefined = leave as is
      function shrink(file) {
        return new Promise(function (res, rej) {
          var img = new Image(), url = URL.createObjectURL(file);
          img.onload = function () {
            var w = 240; while (w >= 60) {
              var sc = Math.min(1, w / img.width), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
              c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
              var out = c.toDataURL('image/png'); if (out.length > 40000) out = c.toDataURL('image/jpeg', 0.85);
              if (out.length <= 40000) { URL.revokeObjectURL(url); return res(out); } w -= 40;
            }
            rej(new Error('That picture is too detailed to shrink. Try a simpler logo.'));
          };
          img.onerror = function () { rej(new Error('That file could not be read as a picture.')); }; img.src = url;
        });
      }
      v.querySelector('#blogo').onchange = function (e) { if (!e.target.files[0]) return; shrink(e.target.files[0]).then(function (d) { newLogo = d; v.querySelector('#bprev').innerHTML = '<img class="rc-logo" src="' + d + '" alt="">'; }).catch(fail); };
      bf.onsubmit = function (e) { e.preventDefault(); var f = e.target, d = { color: f.color.value, accent: f.accent.value, tagline: f.tagline.value }; if (newLogo !== undefined) d.logo = newLogo; busy(f.querySelector('button'), function () { return API.call('branding.save', d).then(function (b) { applyBrand(b); toast('Branding saved.'); render(); }); }); };
      v.querySelector('#bclear').onclick = function () { if (confirm('Remove the logo and go back to the standard colours?')) API.call('branding.save', { logo: '', color: '', accent: '', tagline: '' }).then(function (b) { applyBrand(b); toast('Branding cleared.'); render(); }).catch(fail); };
    }
    var hf = v.querySelector('#hf'); if (hf) hf.onsubmit = function (e) { e.preventDefault(); busy(e.target.querySelector('button'), function () { return API.call('hotel.save', formData(e.target)).then(function (r) { S.hotel = r; toast('Hotel saved.'); refresh(); }); }); };
    v.querySelector('#pw').onsubmit = function (e) { e.preventDefault(); var f = e.target; busy(f.querySelector('button'), function () { return API.call('auth.changePassword', formData(f)).then(function () { f.reset(); toast('Password changed. Other devices were signed out.'); }); }); };
    return Promise.resolve();
  };
  VIEWS.audit = function (v) {
    return API.call('audit.list', { limit: 300 }).then(function (rows) {
      v.innerHTML = '<div class="card">' + table(['When', 'User', 'Action', 'Record', 'Detail'], rows.map(function (r) { return '<tr><td class="muted" style="white-space:nowrap">' + esc(r.created_at) + '</td><td>' + esc(r.username) + '</td><td>' + esc(r.action) + '</td><td>' + esc(r.record_type) + ' ' + esc(r.record_id) + '</td><td>' + esc([r.old_value, r.new_value].filter(Boolean).join(' → ')) + (r.reason ? ' <span class="muted">· ' + esc(r.reason) + '</span>' : '') + '</td></tr>'; }), 'No activity yet.') + '</div>';
    });
  };

  // ======================= Payroll, Room Service, Car Rental, Events, Accounting =======================
  var MORE = {};
  function methodSel(name, req) { return '<select name="' + name + '"' + (req ? ' required' : '') + '><option value="">Choose…</option>' + opts(S.methods, 'id', function (m) { return m.name; }) + '</select>'; }
  function inhSel(inh, name) { return '<select name="' + name + '">' + (inh.length ? opts(inh, 'folio_id', function (s) { return 'Room ' + s.room_number + ' — ' + s.guest_name; }) : '<option value="">No guests in house</option>') + '</select>'; }
  function tabBar(act, cur, list) { return '<div class="tabs">' + list.map(function (t) { return '<button data-act="' + act + '" data-t="' + t[0] + '" class="' + (cur === t[0] ? 'on' : '') + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>'; }
  function yesNo(v) { return v ? 'Yes' : 'No'; }
  function formModal(title, html, onSubmit, wide) {
    return modal(title, '<form id="fm">' + html + '<div class="actions"><button type="submit">Save</button></div></form>', function (m) {
      m.el.querySelector('#fm').onsubmit = function (e) { e.preventDefault(); busy(e.target.querySelector('button'), function () { return onSubmit(formData(e.target), m); }); };
    });
  }
  function settleModal(title, total, isRoom, action, idKey, id, done) {
    modal(title, '<p>Amount: <b>' + money(total) + '</b></p><form id="sm">' + (isRoom ? '<div class="f"><label>How</label><select name="mode" id="smm"><option value="charge_to_room">Charge to the guest\'s room bill</option><option value="pay_now">Charge to room and take payment now</option></select></div><div class="f" id="smp" style="display:none"><label>Payment method</label>' + methodSel('payment_method_id') + '</div>' : (total > 0 ? '<div class="f"><label>Payment method *</label>' + methodSel('payment_method_id', true) + '</div>' : '<p class="muted">Complimentary: nothing to collect.</p>')) + '<div class="actions"><button type="submit">Settle</button></div></form>', function (m) {
      var mm = m.el.querySelector('#smm'); if (mm) mm.onchange = function () { m.el.querySelector('#smp').style.display = mm.value === 'pay_now' ? '' : 'none'; };
      m.el.querySelector('#sm').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); d[idKey] = id; busy(e.target.querySelector('button'), function () { return API.call(action, d).then(function () { m.close(); toast('Settled.'); done(); }); }); };
    });
  }

  // ----- payroll -----
  var PAGE_TABS = {};
  VIEWS.payroll = function (v) {
    var tab = S.prTab || 'runs';
    var head = tabBar('prtab', tab, [['runs', 'Payroll runs'], ['staff', 'Staff'], ['settings', 'Rates & PAYE bands']]);
    if (tab === 'staff') return API.call('payroll.staff').then(function (rows) {
      S.prStaff = rows;
      v.innerHTML = head + '<div class="card">' + (can('payroll.manage') ? '<button class="sm gold" data-act="prstaffnew" style="float:right">+ Add staff</button>' : '') + '<h3>Staff</h3>' + table(['No.', 'Name', 'Job title', '>Basic', '>Allowances', 'Exempt', 'Status', ''], rows.map(function (s) {
        return '<tr><td>' + esc(s.staff_number) + '</td><td>' + esc(s.full_name) + '</td><td>' + esc(s.job_title) + '</td><td class="r">' + money(s.basic_salary) + '</td><td class="r">' + money(s.default_allowances) + '</td><td>' + (s.ssnit_exempt ? 'SSNIT ' : '') + (s.paye_exempt ? 'PAYE' : '') + '</td><td>' + (s.is_active ? '<span class="pill ok">active</span>' : '<span class="pill">inactive</span>') + '</td><td class="actions">' + (can('payroll.manage') ? '<button class="sm sec" data-act="prstaffedit" data-id="' + s.id + '">Edit</button>' : '') + '</td></tr>'; }), 'No staff yet.') + '</div>';
    });
    if (tab === 'settings') return API.call('payroll.settings').then(function (s) {
      var ed = can('payroll.manage');
      v.innerHTML = head + '<div class="card"><h3>Rates & PAYE bands</h3><form id="prs"><div class="row"><div class="f"><label>Employee SSNIT %</label><input name="ssnit_employee_rate" type="number" step="0.01" value="' + esc(s.ssnit_employee_rate) + '"' + (ed ? '' : ' disabled') + '></div><div class="f"><label>Employer SSNIT %</label><input name="ssnit_employer_rate" type="number" step="0.01" value="' + esc(s.ssnit_employer_rate) + '"' + (ed ? '' : ' disabled') + '></div></div>' +
        '<div class="f"><label>PAYE bands: one per line as <code>width,rate%</code>; the last line may be <code>rest,rate</code></label><textarea name="paye_bands" rows="9"' + (ed ? '' : ' disabled') + '>' + esc(s.paye_bands) + '</textarea></div>' + (ed ? '<div class="actions"><button type="submit">Save</button></div>' : '') + '</form><p class="muted">SSNIT is worked out on basic pay. PAYE is worked out on gross pay minus the employee SSNIT. Changes apply to new runs and to Recalculate on a draft run.</p></div>';
      var f = v.querySelector('#prs'); if (f) f.onsubmit = function (e) { e.preventDefault(); busy(f.querySelector('button'), function () { return API.call('payroll.settingsSave', formData(f)).then(function () { toast('Saved.'); }); }); };
    });
    return API.call('payroll.runs').then(function (rows) {
      v.innerHTML = head + '<div class="card">' + (can('payroll.manage') ? '<button class="sm gold" data-act="prrunnew" style="float:right">+ New payroll run</button>' : '') + '<h3>Payroll runs</h3>' + table(['Run', 'Month', 'Status', '>Staff', '>Gross', '>Net pay', '>Cost to hotel', ''], rows.map(function (r) {
        return '<tr><td>' + esc(r.run_number) + '</td><td>' + esc(r.period) + '</td><td>' + pill(r.status) + '</td><td class="r">' + r.totals.staff + '</td><td class="r">' + money(r.totals.gross) + '</td><td class="r">' + money(r.totals.net) + '</td><td class="r">' + money(r.totals.employer_cost) + '</td><td class="actions"><button class="sm sec" data-act="prrun" data-id="' + r.id + '">Open</button></td></tr>'; }), 'No payroll runs yet. Add your staff first, then start a run.') + '</div>';
    });
  };
  function staffModal(s) {
    s = s || {};
    formModal(s.id ? 'Edit staff' : 'Add staff', '<div class="row"><div class="f"><label>Full name *</label><input name="full_name" required value="' + esc(s.full_name) + '"></div><div class="f"><label>Job title</label><input name="job_title" value="' + esc(s.job_title) + '"></div></div><div class="row"><div class="f"><label>Department</label><input name="department" value="' + esc(s.department) + '"></div><div class="f"><label>Phone</label><input name="phone" value="' + esc(s.phone) + '"></div></div>' +
      '<div class="row"><div class="f"><label>Monthly basic salary *</label><input name="basic_salary" type="number" step="0.01" min="0" required value="' + esc(s.basic_salary) + '"></div><div class="f"><label>Monthly allowances</label><input name="default_allowances" type="number" step="0.01" min="0" value="' + esc(s.default_allowances || 0) + '"></div></div>' +
      '<div class="row"><div class="f"><label>SSNIT number</label><input name="ssnit_number" value="' + esc(s.ssnit_number) + '"></div><div class="f"><label>TIN</label><input name="tin_number" value="' + esc(s.tin_number) + '"></div></div><div class="row"><div class="f"><label>Bank / MoMo details</label><input name="bank_details" value="' + esc(s.bank_details) + '"></div><div class="f"><label>Start date</label><input type="date" name="start_date" value="' + esc(s.start_date) + '"></div></div>' +
      '<div class="row"><label class="chk f"><input type="checkbox" name="ssnit_exempt"' + (s.ssnit_exempt ? ' checked' : '') + '> Exempt from SSNIT</label><label class="chk f"><input type="checkbox" name="paye_exempt"' + (s.paye_exempt ? ' checked' : '') + '> Exempt from PAYE</label>' + (s.id ? '<label class="chk f"><input type="checkbox" name="is_active"' + (s.is_active ? ' checked' : '') + '> Active</label>' : '') + '</div>',
      function (d, m) { if (s.id) d.id = s.id; return API.call('payroll.staffSave', d).then(function () { m.close(); toast('Saved.'); refresh(); }); });
  }
  function runModal(id) {
    if (S.rm) { S.rm.close(); S.rm = null; }
    API.call('payroll.run', { run_id: id }).then(function (r) {
      var t = r.totals, draft = r.status === 'draft', mg = can('payroll.manage'), ap = can('payroll.approve');
      var btn = function (a, label, cls) { return '<button class="sm ' + (cls || 'sec') + '" data-act="' + a + '" data-run="' + r.id + '">' + label + '</button> '; };
      S.rm = modal('Payroll ' + r.run_number + ' — ' + r.period, '<div class="kv"><b>Status</b><span>' + pill(r.status) + '</span><b>Gross pay</b><span>' + money(t.gross) + '</span><b>SSNIT (employee + employer)</b><span>' + money(t.ssnit_total) + '</span><b>PAYE</b><span>' + money(t.paye) + '</span><b>Net pay to staff</b><span class="total">' + money(t.net) + '</span><b>Cost to hotel (net + SSNIT + PAYE)</b><span>' + money(t.employer_cost) + '</span></div>' +
        (r.notes ? '<p class="muted">' + esc(r.notes) + '</p>' : '') +
        '<div class="actions noprint" style="margin:10px 0">' + (draft && mg ? btn('prrecalc', 'Recalculate from staff list') + btn('pradd', 'Add missing staff') : '') + (draft && ap ? btn('prapprove', 'Approve', 'gold') : '') + (draft && mg ? btn('prdelete', 'Delete run') : '') + (r.status === 'approved' && ap ? btn('prunapprove', 'Back to draft') + btn('prpost', 'Post to Expenses', 'gold') : '') + (r.status === 'posted' && ap ? btn('prreverse', 'Reverse posting') : '') + '</div>' +
        table(['Staff', '>Basic', '>Allow.', '>Bonus', '>Gross', '>SSNIT', '>PAYE', '>Other ded.', '>Net', ''], r.lines.map(function (l) {
          return '<tr><td>' + esc(l.staff_name) + '<div class="muted">' + esc(l.job_title) + '</div></td><td class="r">' + money(l.basic) + '</td><td class="r">' + money(l.allowances) + '</td><td class="r">' + money(l.bonus) + '</td><td class="r">' + money(l.gross) + '</td><td class="r">' + money(l.ssnit_employee) + '</td><td class="r">' + money(l.paye) + (l.paye_override ? '*' : '') + '</td><td class="r">' + money(l.other_deductions) + '</td><td class="r"><b>' + money(l.net) + '</b></td><td class="actions"><button class="sm sec" data-act="prslip" data-line="' + l.id + '">Payslip</button>' + (draft && mg ? ' <button class="sm sec" data-act="predit" data-run="' + r.id + '" data-line="' + l.id + '">Edit</button> <button class="sm sec" data-act="prrm" data-run="' + r.id + '" data-line="' + l.id + '">Remove</button>' : '') + '</td></tr>'; }), 'No staff on this run.') +
        '<p class="muted">* PAYE typed in by hand.</p>' + (r.expenses.length ? '<h4>Posted to Expenses</h4>' + table(['Expense', 'For', 'Payee', '>Amount', 'Status'], r.expenses.map(function (e) { return '<tr><td>' + esc(e.expense_number) + '</td><td>' + esc(e.kind) + '</td><td>' + esc(e.payee) + '</td><td class="r">' + money(e.amount) + '</td><td>' + pill(e.status) + '</td></tr>'; })) : ''),
        function (m) { var close = m.close; m.close = function () { S.rm = null; close(); }; });
      S.rm.el.parentNode.style.maxWidth = '1180px'; S.rm.el.parentNode.style.width = '96vw';
    }).catch(fail);
  }
  function prDo(b, action, extra, msg) { var id = Number(b.getAttribute('data-run')); busy(b, function () { return API.call(action, Object.assign({ run_id: id }, extra || {})).then(function () { toast(msg || 'Done.'); runModal(id); if (S.route === 'payroll') refreshBehind(); }); }); }
  function refreshBehind() { var v = document.getElementById('view'); if (v && VIEWS[S.route]) VIEWS[S.route](v).catch(fail); }
  Object.assign(MORE, {
    prtab: function (b) { S.prTab = b.getAttribute('data-t'); refresh(); },
    prstaffnew: function () { staffModal(); },
    prstaffedit: function (b) { staffModal(S.prStaff.filter(function (s) { return String(s.id) === b.getAttribute('data-id'); })[0]); },
    prrunnew: function () { formModal('New payroll run', '<div class="f"><label>Pay month *</label><input type="month" name="period" required value="' + today().slice(0, 7) + '"></div><div class="f"><label>Notes</label><input name="notes"></div><p class="muted">Every active staff member is added with their salary and allowances. You can adjust bonuses and deductions before approving.</p>', function (d, m) { return API.call('payroll.runCreate', d).then(function (r) { m.close(); toast('Run created.'); refresh(); runModal(r.id); }); }); },
    prrun: function (b) { runModal(b.getAttribute('data-id')); },
    prrecalc: function (b) { prDo(b, 'payroll.recalculate', null, 'Recalculated.'); },
    pradd: function (b) { var id = Number(b.getAttribute('data-run')); busy(b, function () { return API.call('payroll.addMissing', { run_id: id }).then(function (r) { toast(r.added + ' added.'); runModal(id); }); }); },
    prapprove: function (b) { if (confirm('Approve this payroll? Figures can no longer be edited unless you take it back to draft.')) prDo(b, 'payroll.approve', null, 'Approved.'); },
    prunapprove: function (b) { prDo(b, 'payroll.unapprove', null, 'Back to draft.'); },
    prdelete: function (b) { if (confirm('Delete this draft payroll run?')) { var id = Number(b.getAttribute('data-run')); busy(b, function () { return API.call('payroll.runDelete', { run_id: id }).then(function () { if (S.rm) S.rm.close(); toast('Deleted.'); refresh(); }); }); } },
    prpost: function (b) { var id = Number(b.getAttribute('data-run')); modal('Post payroll to Expenses', '<p>This records three expenses: net salaries, SSNIT and PAYE (zero amounts are skipped).</p><form id="pp"><div class="f"><label>Paid by *</label>' + methodSel('payment_method_id', true) + '</div><div class="actions"><button type="submit">Post</button></div></form>', function (m) {
      m.el.querySelector('#pp').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); d.run_id = id; busy(e.target.querySelector('button'), function () { return API.call('payroll.post', d).then(function (r) { m.close(); toast('Posted: ' + r.expenses.join(', ')); runModal(id); refreshBehind(); }); }); }; }); },
    prreverse: function (b) { var r = prompt('Reason for reversing this posted payroll (its expenses will be voided):'); if (r) prDo(b, 'payroll.reverse', { reason: r }, 'Reversed.'); },
    prslip: function (b) { API.call('payroll.payslip', { line_id: Number(b.getAttribute('data-line')) }).then(showReceipt).catch(fail); },
    prrm: function (b) { if (confirm('Remove this person from the run?')) { var id = Number(b.getAttribute('data-run')); busy(b, function () { return API.call('payroll.removeLine', { line_id: Number(b.getAttribute('data-line')) }).then(function () { runModal(id); refreshBehind(); }); }); } },
    predit: function (b) {
      var id = Number(b.getAttribute('data-run')), lid = b.getAttribute('data-line');
      API.call('payroll.run', { run_id: id }).then(function (r) { var l = r.lines.filter(function (x) { return String(x.id) === lid; })[0];
        formModal('Pay for ' + l.staff_name, '<div class="row"><div class="f"><label>Allowances</label><input name="allowances" type="number" step="0.01" min="0" value="' + l.allowances + '"></div><div class="f"><label>Bonus / overtime</label><input name="bonus" type="number" step="0.01" min="0" value="' + l.bonus + '"></div></div><div class="row"><div class="f"><label>Other deductions</label><input name="other_deductions" type="number" step="0.01" min="0" value="' + l.other_deductions + '"></div><div class="f"><label>Deduction note</label><input name="deduction_note" value="' + esc(l.deduction_note) + '"></div></div><div class="f"><label>PAYE (leave empty to calculate)</label><input name="paye" type="number" step="0.01" min="0" value="' + (l.paye_override ? l.paye : '') + '"></div>',
          function (d, m) { d.line_id = Number(lid); return API.call('payroll.lineSave', d).then(function () { m.close(); toast('Saved.'); runModal(id); refreshBehind(); }); }); }).catch(fail);
    }
  });

  // ----- room service -----
  VIEWS.roomservice = function (v) {
    var tab = S.rsTab || 'orders', tabs = [['orders', 'Orders']]; if (can('room_service.manage')) tabs.push(['menu', 'Menu']);
    return Promise.all([API.call('roomService.orders'), API.call('roomService.menu')]).then(function (r) {
      var orders = r[0], menu = r[1]; S.rsMenu = menu;
      if (tab === 'menu') v.innerHTML = tabBar('rstab', tab, tabs) + '<div class="card"><button class="sm gold" data-act="rsmenunew" style="float:right">+ Add item</button><h3>Room service menu</h3>' + table(['Item', 'Category', '>Price', 'Status', ''], menu.map(function (m) { return '<tr><td>' + esc(m.name) + '</td><td>' + esc(m.category) + '</td><td class="r">' + money(m.price) + '</td><td>' + (m.is_active ? '<span class="pill ok">on</span>' : '<span class="pill">off</span>') + '</td><td class="actions"><button class="sm sec" data-act="rsmenuedit" data-id="' + m.id + '">Edit</button></td></tr>'; }), 'No items yet.') + '</div>';
      else v.innerHTML = tabBar('rstab', tab, tabs) + '<div class="card">' + (can('room_service.transact') ? '<button class="sm gold" data-act="rsnew" style="float:right">+ New order</button>' : '') + '<h3>Room service orders</h3>' + table(['Order', 'Room', 'Guest', 'Status', '>Total', ''], orders.map(function (o) { return '<tr><td>' + esc(o.order_number) + '<div class="muted">' + esc(o.created_at.substr(0, 16)) + '</div></td><td>' + esc(o.room_number) + '</td><td>' + esc(o.guest_name) + '</td><td>' + pill(o.status) + '</td><td class="r">' + money(o.total) + '</td><td class="actions"><button class="sm sec" data-act="rsopen" data-id="' + o.id + '">Open</button></td></tr>'; }), 'No orders yet.') + '</div>';
    });
  };
  function rsModal(id) {
    if (S.rsm) { S.rsm.close(); S.rsm = null; }
    API.call('roomService.order', { order_id: id }).then(function (o) {
      var tr = can('room_service.transact'), open = o.status === 'open', live = ['open', 'sent_to_kitchen', 'out_for_delivery', 'delivered'].indexOf(o.status) !== -1;
      var B = function (a, l, c) { return '<button class="sm ' + (c || 'sec') + '" data-act="' + a + '" data-id="' + o.id + '">' + l + '</button> '; };
      S.rsm = modal('Room service ' + o.order_number + ' — Room ' + o.room_number, '<div class="kv"><b>Guest</b><span>' + esc(o.guest_name) + '</span><b>Status</b><span>' + pill(o.status) + '</span></div>' +
        table(['Item', '>Qty', '>Price', '>Amount', ''], o.items.map(function (i) { return '<tr><td>' + esc(i.description) + '</td><td class="r">' + i.quantity + '</td><td class="r">' + money(i.unit_price) + '</td><td class="r">' + money(i.amount) + '</td><td>' + (open && tr ? '<button class="sm sec" data-act="rsrm" data-id="' + o.id + '" data-item="' + i.id + '">×</button>' : '') + '</td></tr>'; }), 'No items yet.') +
        '<div class="kv" style="margin-top:8px"><b>Total</b><span class="total">' + money(o.total) + '</span></div>' +
        (open && tr ? '<form id="ai" class="row" style="align-items:flex-end;margin-top:10px"><div class="f"><label>Menu item</label><select name="menu_item_id"><option value="">Other (type below)…</option>' + opts(S.rsMenu.filter(function (m) { return m.is_active; }), 'id', function (m) { return m.name + ' — ' + money(m.price); }) + '</select></div><div class="f"><label>Other item</label><input name="description" placeholder="description"></div><div class="f" style="max-width:100px"><label>Price</label><input name="unit_price" type="number" step="0.01" min="0.01"></div><div class="f" style="max-width:80px"><label>Qty</label><input name="quantity" type="number" min="1" value="1"></div><div class="f" style="flex:0 0 auto"><button type="submit">Add</button></div></form>' : '') +
        (tr && live ? '<div class="actions" style="margin-top:12px">' + (open ? B('rssend', 'Send to kitchen', 'gold') : '') + (o.status === 'sent_to_kitchen' ? B('rsout', 'Out for delivery', 'gold') : '') + (o.status === 'out_for_delivery' ? B('rsdone', 'Mark delivered', 'gold') : '') + B('rssettle', 'Settle', 'gold') + B('rscancel', 'Cancel order') + '</div>' : ''),
        function (m) { var cl = m.close; m.close = function () { S.rsm = null; cl(); }; var f = m.el.querySelector('#ai'); if (f) f.onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); d.order_id = id; busy(f.querySelector('button'), function () { return API.call('roomService.addItem', d).then(function () { rsModal(id); }); }); }; });
    }).catch(fail);
  }
  function rsStep(b, action, msg) { var id = Number(b.getAttribute('data-id')); busy(b, function () { return API.call(action, { order_id: id }).then(function () { toast(msg); rsModal(id); refreshBehind(); }); }); }
  Object.assign(MORE, {
    rstab: function (b) { S.rsTab = b.getAttribute('data-t'); refresh(); },
    rsmenunew: function () { rsMenuModal(); }, rsmenuedit: function (b) { rsMenuModal(S.rsMenu.filter(function (m) { return String(m.id) === b.getAttribute('data-id'); })[0]); },
    rsnew: function () { API.call('frontdesk.inHouse').then(function (inh) { formModal('New room service order', '<div class="f"><label>Room *</label>' + inhSel(inh, 'folio_id') + '</div><div class="f"><label>Notes</label><input name="notes"></div>', function (d, m) { return API.call('roomService.create', d).then(function (o) { m.close(); refresh(); rsModal(o.id); }); }); }).catch(fail); },
    rsopen: function (b) { rsModal(b.getAttribute('data-id')); },
    rsrm: function (b) { var id = Number(b.getAttribute('data-id')); busy(b, function () { return API.call('roomService.removeItem', { item_id: Number(b.getAttribute('data-item')) }).then(function () { rsModal(id); }); }); },
    rssend: function (b) { rsStep(b, 'roomService.send', 'Sent to the kitchen.'); }, rsout: function (b) { rsStep(b, 'roomService.out', 'Out for delivery.'); }, rsdone: function (b) { rsStep(b, 'roomService.delivered', 'Delivered.'); },
    rscancel: function (b) { if (confirm('Cancel this order?')) rsStep(b, 'roomService.cancel', 'Cancelled.'); },
    rssettle: function (b) { var id = Number(b.getAttribute('data-id')); API.call('roomService.order', { order_id: id }).then(function (o) { settleModal('Settle ' + o.order_number, o.total, true, 'roomService.settle', 'order_id', id, function () { rsModal(id); refreshBehind(); }); }).catch(fail); }
  });
  function rsMenuModal(m) { m = m || {}; formModal(m.id ? 'Edit menu item' : 'Add menu item', '<div class="f"><label>Name *</label><input name="name" required value="' + esc(m.name) + '"></div><div class="row"><div class="f"><label>Category</label><input name="category" value="' + esc(m.category) + '"></div><div class="f"><label>Price *</label><input name="price" type="number" step="0.01" min="0.01" required value="' + esc(m.price) + '"></div></div>' + (m.id ? '<label class="chk f"><input type="checkbox" name="is_active"' + (m.is_active ? ' checked' : '') + '> Available</label>' : ''), function (d, mm) { if (m.id) d.id = m.id; return API.call('roomService.menuSave', d).then(function () { mm.close(); toast('Saved.'); refresh(); }); }); }

  // ----- car rental -----
  VIEWS.carrental = function (v) {
    var tab = S.carTab || 'bookings', tabs = [['bookings', 'Bookings'], ['vehicles', 'Vehicles']];
    return Promise.all([API.call('car.bookings'), API.call('car.vehicles')]).then(function (r) {
      var bk = r[0], vh = r[1]; S.carVeh = vh;
      if (tab === 'vehicles') v.innerHTML = tabBar('cartab', tab, tabs) + '<div class="card">' + (can('car_rental.manage') ? '<button class="sm gold" data-act="carvnew" style="float:right">+ Add vehicle</button>' : '') + '<h3>Fleet</h3>' + table(['Vehicle', 'Type', '>Daily rate', 'Status', ''], vh.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.vehicle_type) + '</td><td class="r">' + money(x.daily_rate) + '</td><td>' + (x.is_active ? '<span class="pill ok">active</span>' : '<span class="pill">inactive</span>') + '</td><td class="actions">' + (can('car_rental.manage') ? '<button class="sm sec" data-act="carvedit" data-id="' + x.id + '">Edit</button>' : '') + '</td></tr>'; }), 'No vehicles yet.') + '</div>';
      else v.innerHTML = tabBar('cartab', tab, tabs) + '<div class="card">' + (can('car_rental.transact') ? '<button class="sm gold" data-act="carnew" style="float:right">+ New rental</button>' : '') + '<h3>Rental bookings</h3>' + table(['Booking', 'Vehicle', 'Renter', 'Pickup', 'Return', '>Amount', 'Status', ''], bk.map(function (b) {
        return '<tr><td>' + esc(b.booking_number) + '</td><td>' + esc(b.vehicle_name) + '</td><td>' + esc(b.renter) + (b.room_number ? '<div class="muted">Room ' + esc(b.room_number) + '</div>' : '') + '</td><td>' + esc(b.pickup_at) + '</td><td>' + esc(b.return_at) + '</td><td class="r">' + money(b.amount) + '</td><td>' + pill(b.status) + '</td><td class="actions">' + (b.status === 'open' && can('car_rental.transact') ? '<button class="sm gold" data-act="carsettle" data-id="' + b.id + '" data-amt="' + b.amount + '" data-room="' + (b.settlement_type === 'room_charge' ? 1 : 0) + '">Settle</button> <button class="sm sec" data-act="carcancel" data-id="' + b.id + '">Cancel</button>' : '') + (b.status === 'settled' ? '<button class="sm sec" data-act="carrcpt" data-id="' + b.id + '">Receipt</button>' : '') + '</td></tr>'; }), 'No rentals yet.') + '</div>';
    });
  };
  Object.assign(MORE, {
    cartab: function (b) { S.carTab = b.getAttribute('data-t'); refresh(); },
    carvnew: function () { carVehModal(); }, carvedit: function (b) { carVehModal(S.carVeh.filter(function (x) { return String(x.id) === b.getAttribute('data-id'); })[0]); },
    carnew: function () {
      var veh = S.carVeh.filter(function (x) { return x.is_active; }); if (!veh.length) return toast('Add a vehicle first.', true);
      API.call('frontdesk.inHouse').then(function (inh) {
        formModal('New car rental', '<div class="f"><label>Vehicle *</label><select name="vehicle_id">' + opts(veh, 'id', function (x) { return x.name + ' — ' + money(x.daily_rate) + '/day'; }) + '</select></div><div class="f"><label>Rented by</label><select name="settlement_type" id="cst"><option value="walk_in">Walk-in customer (pays at settlement)</option><option value="room_charge">In-house guest (charge to room)</option></select></div>' +
          '<div class="f" id="cwi"><label>Customer name *</label><input name="customer_name"></div><div class="f" id="crm" style="display:none"><label>Room</label>' + inhSel(inh, 'folio_id') + '</div><div class="row"><div class="f"><label>Pickup *</label><input type="datetime-local" name="pickup_at" required></div><div class="f"><label>Return *</label><input type="datetime-local" name="return_at" required></div></div>' +
          '<div class="row"><div class="f"><label>Driver licence no.</label><input name="driver_license_number"></div><div class="f"><label>Amount (empty = days × daily rate)</label><input name="amount" type="number" step="0.01" min="0"></div></div>',
          function (d, m) { if (d.settlement_type === 'room_charge') d.customer_name = ''; else d.folio_id = ''; return API.call('car.create', d).then(function (b) { m.close(); toast('Booked ' + b.booking_number + ' for ' + money(b.amount) + '.'); refresh(); }); });
        var s = document.getElementById('cst'); s.onchange = function () { var rc = s.value === 'room_charge'; document.getElementById('crm').style.display = rc ? '' : 'none'; document.getElementById('cwi').style.display = rc ? 'none' : ''; };
      }).catch(fail);
    },
    carsettle: function (b) { settleModal('Settle rental', Number(b.getAttribute('data-amt')), b.getAttribute('data-room') === '1', 'car.settle', 'booking_id', Number(b.getAttribute('data-id')), refresh); },
    carcancel: function (b) { if (confirm('Cancel this rental booking?')) busy(b, function () { return API.call('car.cancel', { booking_id: Number(b.getAttribute('data-id')) }).then(function () { toast('Cancelled.'); refresh(); }); }); },
    carrcpt: function (b) { API.call('car.receipt', { booking_id: Number(b.getAttribute('data-id')) }).then(showReceipt).catch(fail); }
  });
  function carVehModal(x) { x = x || {}; formModal(x.id ? 'Edit vehicle' : 'Add vehicle', '<div class="f"><label>Name / plate *</label><input name="name" required value="' + esc(x.name) + '" placeholder="Toyota Corolla - GR-1234-20"></div><div class="row"><div class="f"><label>Type</label><input name="vehicle_type" value="' + esc(x.vehicle_type) + '"></div><div class="f"><label>Daily rate</label><input name="daily_rate" type="number" step="0.01" min="0" value="' + esc(x.daily_rate || 0) + '"></div></div>' + (x.id ? '<label class="chk f"><input type="checkbox" name="is_active"' + (x.is_active ? ' checked' : '') + '> Active</label>' : ''), function (d, m) { if (x.id) d.id = x.id; return API.call('car.vehicleSave', d).then(function () { m.close(); toast('Saved.'); refresh(); }); }); }


  // ----- refunds (approval), maintenance, rate plans -----
  var WALK_MODS = [['restaurant', 'Restaurant'], ['car', 'Car rental']].concat(Object.keys(OUTLET_NAMES()).map(function (k) { return ['outlet:' + k, OUTLET_NAMES()[k]]; }));
  function OUTLET_NAMES() { return { bar: 'Bar', gift_shop: 'Gift Shop', business_centre: 'Business Centre', salon: 'Salon', spa: 'Spa', laundry: 'Laundry', gym: 'Gym', pool: 'Pool', parking: 'Parking', transport: 'Transport' }; }
  VIEWS.refunds = function (v) {
    var tab = S.rfTab || 'folio', tabs = [['folio', 'Guest-bill refunds'], ['walkin', 'Walk-in refunds']], canApprove = can('payments.approve_refunds');
    return Promise.all([API.call('refunds.list'), API.call('walkinRefunds.list'), canApprove ? API.call('refunds.policy') : Promise.resolve(null)]).then(function (r) {
      var fl = r[0], wl = r[1], pol = r[2];
      function acts(x, kind) { return x.status === 'pending' && canApprove ? '<button class="sm" data-act="' + kind + 'ok" data-id="' + x.id + '">Approve</button> <button class="sm danger" data-act="' + kind + 'no" data-id="' + x.id + '">Reject</button>' : ''; }
      var head = '<div class="card">' + (can('settings.manage') && pol ? '<label class="chk"><input type="checkbox" id="rfpol"' + (pol.require_refund_approval ? ' checked' : '') + '> Refunds on guest bills need a second person to approve</label><p class="muted">When on, the Reverse button sends a request instead. Nobody can approve their own request.</p>' : '') + '</div>';
      if (tab === 'walkin') v.innerHTML = head + tabBar('rftab', tab, tabs) + '<div class="card">' + '<button class="sm gold" data-act="wrnew" style="float:right">+ Walk-in refund</button><h3>Walk-in refunds</h3>' + table(['Sale', 'Section', '>Amount', 'Via', 'Reason', 'Status', 'By', ''], wl.map(function (x) { return '<tr><td>' + esc(x.record_number) + '</td><td>' + esc(x.module_code.replace('outlet:', '')) + '</td><td class="r">' + money(x.amount) + '</td><td>' + esc(x.method_name) + '</td><td>' + esc(x.reason) + (x.review_notes ? '<div class="muted">' + esc(x.review_notes) + '</div>' : '') + '</td><td>' + pill(x.status) + '</td><td>' + esc(x.requested_by_name) + '</td><td class="actions">' + acts(x, 'wr') + '</td></tr>'; }), 'No walk-in refunds.') + '</div>';
      else v.innerHTML = head + tabBar('rftab', tab, tabs) + '<div class="card"><h3>Guest-bill refund requests</h3><p class="muted">Request a refund from the guest\'s bill (Front Desk → open the folio → Reverse).</p>' + table(['Receipt', 'Folio', '>Amount', 'Reason', 'Status', 'By', ''], fl.map(function (x) { return '<tr><td>' + esc(x.receipt_number) + '</td><td>' + esc(x.folio_number) + '</td><td class="r">' + money(x.amount) + '</td><td>' + esc(x.reason) + (x.review_notes ? '<div class="muted">' + esc(x.review_notes) + '</div>' : '') + '</td><td>' + pill(x.status) + '</td><td>' + esc(x.requested_by_name) + '</td><td class="actions">' + acts(x, 'rf') + '</td></tr>'; }), 'No refund requests.') + '</div>';
      var cb = v.querySelector('#rfpol'); if (cb) cb.onchange = function () { API.call('refunds.setPolicy', { require_refund_approval: cb.checked }).then(function () { toast(cb.checked ? 'Approval is now required.' : 'Approval is now off.'); }).catch(function (e) { cb.checked = !cb.checked; fail(e); }); };
    });
  };
  function rfDo(b, action, extra, msg) { busy(b, function () { var d = { id: Number(b.getAttribute('data-id')) }; Object.assign(d, extra); return API.call(action, d).then(function () { toast(msg); refresh(); }); }); }
  Object.assign(MORE, {
    rftab: function (b) { S.rfTab = b.getAttribute('data-t'); refresh(); },
    rfok: function (b) { if (confirm('Approve this refund and reverse the payment?')) rfDo(b, 'refunds.approve', {}, 'Approved and reversed.'); },
    rfno: function (b) { var n = prompt('Reason for rejecting:'); if (n) rfDo(b, 'refunds.reject', { notes: n }, 'Rejected.'); },
    wrok: function (b) { if (confirm('Approve this refund? It will be taken off that section\'s sales.')) rfDo(b, 'walkinRefunds.approve', {}, 'Approved.'); },
    wrno: function (b) { var n = prompt('Reason for rejecting:'); if (n) rfDo(b, 'walkinRefunds.reject', { notes: n }, 'Rejected.'); },
    wrnew: function () {
      formModal('Walk-in refund request', '<div class="f"><label>Section *</label><select name="module">' + WALK_MODS.map(function (m) { return '<option value="' + m[0] + '">' + esc(m[1]) + '</option>'; }).join('') + '</select></div><div class="f"><label>Sale / order / booking number *</label><input name="number" required placeholder="e.g. RST-00012"></div><div class="row"><div class="f"><label>Refund amount *</label><input name="amount" type="number" step="0.01" min="0.01" required></div><div class="f"><label>Money goes back via *</label>' + methodSel('payment_method_id', true) + '</div></div><div class="f"><label>Reason *</label><input name="reason" required></div><p class="muted">Another person must approve it. Stock is not returned automatically.</p>',
        function (d, m) { return API.call('walkinRefunds.request', d).then(function () { m.close(); toast('Request sent for approval.'); refresh(); }); });
    }
  });

  VIEWS.maintenance = function (v) {
    var st = S.mtSt || 'active';
    return Promise.all([API.call('maintenance.list'), can('maintenance.manage') ? API.call('rooms.list') : Promise.resolve([]), can('maintenance.manage') ? API.call('maintenance.staff') : Promise.resolve([])]).then(function (r) {
      var all = r[0]; S.mtRooms = r[1]; S.mtUsers = r[2];
      var rows = all.filter(function (m) { return st === 'all' || (st === 'active' ? (m.status === 'open' || m.status === 'in_progress') : m.status === st); }), mg = can('maintenance.manage');
      v.innerHTML = '<div class="card">' + (mg ? '<button class="sm gold" data-act="mtnew" style="float:right">+ New request</button>' : '') + '<h3>Maintenance requests</h3><div class="f" style="max-width:200px"><select id="mtst">' + [['active', 'Open & in progress'], ['resolved', 'Resolved'], ['cancelled', 'Cancelled'], ['all', 'All']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === st ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
        table(['Ticket', 'Where', 'Issue', 'Priority', 'Status', '>Cost', 'Assigned', ''], rows.map(function (m) {
          var open = m.status === 'open' || m.status === 'in_progress';
          return '<tr><td>' + esc(m.ticket_number) + '<div class="muted">' + esc(m.reported_at) + '</div></td><td>' + (m.room_number ? 'Room ' + esc(m.room_number) : esc(m.equipment_name)) + (m.took_room_out_of_service ? '<div class="muted">room out of service</div>' : '') + '</td><td>' + esc(m.issue_description) + '</td><td>' + pill(m.priority) + '</td><td>' + pill(m.status) + '</td><td class="r">' + (m.cost ? money(m.cost) : '') + '</td><td>' + esc(m.assigned_name) + '</td><td class="actions">' + (mg && open ? '<button class="sm sec" data-act="mtas" data-id="' + m.id + '">Assign</button> <button class="sm sec" data-act="mtco" data-id="' + m.id + '">Cost</button> <button class="sm" data-act="mtok" data-id="' + m.id + '">Resolve</button> <button class="sm danger" data-act="mtx" data-id="' + m.id + '">Cancel</button>' : '') + '</td></tr>';
        }), 'No maintenance requests here.') + '</div>';
      v.querySelector('#mtst').onchange = function (e) { S.mtSt = e.target.value; refresh(); };
    });
  };
  function mtDo(b, action, extra, msg) { busy(b, function () { var d = { id: Number(b.getAttribute('data-id')) }; Object.assign(d, extra); return API.call(action, d).then(function () { toast(msg); refresh(); }); }); }
  Object.assign(MORE, {
    mtok: function (b) { var n = prompt('What was done? (optional)', ''); if (n !== null) mtDo(b, 'maintenance.resolve', { notes: n }, 'Resolved.'); },
    mtx: function (b) { if (confirm('Cancel this request?')) mtDo(b, 'maintenance.cancel', {}, 'Cancelled.'); },
    mtco: function (b) { var c = prompt('Repair cost (recorded as an expense under Repairs):'); if (c !== null && c !== '') mtDo(b, 'maintenance.cost', { cost: c }, 'Cost recorded.'); },
    mtas: function (b) {
      var id = b.getAttribute('data-id');
      modal('Assign request', '<form id="as"><div class="f"><label>Assign to</label><select name="assigned_to"><option value="">Nobody</option>' + opts(S.mtUsers, 'id', function (u) { return u.full_name; }) + '</select></div><div class="actions"><button type="submit">Save</button></div></form>', function (m) {
        m.el.querySelector('#as').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); d.id = Number(id); busy(e.target.querySelector('button'), function () { return API.call('maintenance.assign', d).then(function () { m.close(); toast('Assigned.'); refresh(); }); }); };
      });
    },
    mtnew: function () {
      var rooms = (S.mtRooms || []).filter(function (r) { return r.is_active; });
      formModal('New maintenance request', '<div class="f"><label>Room</label><select name="room_id" id="mtr"><option value="">— equipment, not a room —</option>' + opts(rooms, 'id', function (r) { return r.room_number + ' (' + r.status + ')'; }) + '</select></div><div class="f" id="mte"><label>Equipment</label><input name="equipment_name" placeholder="e.g. Generator"></div><div class="f"><label>Issue *</label><textarea name="issue_description" required></textarea></div><div class="row"><div class="f"><label>Priority</label><select name="priority"><option>medium</option><option>low</option><option>high</option><option>urgent</option></select></div><label class="chk f"><input type="checkbox" name="take_out_of_service"> Take the room out of service</label></div>',
        function (d, m) { return API.call('maintenance.create', d).then(function (r) { m.close(); toast('Created ' + r.ticket_number + '.'); refresh(); }); });
    }
  });

  VIEWS.rateplans = function (v) {
    return Promise.all([API.call('ratePlans.list'), API.call('roomTypes.list')]).then(function (r) {
      var plans = r[0]; S.rpTypes = r[1]; S.rpPlans = plans; var mg = can('rate_plans.manage');
      v.innerHTML = '<div class="card">' + (mg ? '<button class="sm gold" data-act="rpnew" style="float:right">+ New rate plan</button>' : '') + '<h3>Seasonal rate plans</h3><p class="muted">A plan sets the room rate for arrivals inside its dates. If plans overlap, the one that starts latest wins. Otherwise the room type\'s normal rate applies.</p>' +
        table(['Plan', 'Room type', 'From', 'To', '>Rate', 'Active', ''], plans.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.room_type_name) + '</td><td>' + esc(p.start_date) + '</td><td>' + esc(p.end_date) + '</td><td class="r">' + money(p.rate) + '</td><td>' + (p.is_active ? 'Yes' : 'No') + '</td><td class="actions">' + (mg ? '<button class="sm sec" data-act="rpedit" data-id="' + p.id + '">Edit</button>' : '') + '</td></tr>'; }), 'No rate plans yet.') + '</div>';
    });
  };
  function rpModal(p) {
    p = p || {};
    formModal(p.id ? 'Edit rate plan' : 'New rate plan', '<div class="f"><label>Plan name *</label><input name="name" required value="' + esc(p.name) + '" placeholder="Festive season"></div><div class="row"><div class="f"><label>Room type *</label><select name="room_type_id">' + opts(S.rpTypes, 'id', function (t) { return t.name + ' (normal ' + money(t.base_rate) + ')'; }, p.room_type_id) + '</select></div><div class="f"><label>Rate per night *</label><input name="rate" type="number" step="0.01" min="0" required value="' + esc(p.rate) + '"></div></div><div class="row"><div class="f"><label>From *</label><input type="date" name="start_date" required value="' + esc(p.start_date) + '"></div><div class="f"><label>To *</label><input type="date" name="end_date" required value="' + esc(p.end_date) + '"></div></div><label class="chk"><input type="checkbox" name="is_active"' + (p.id && !p.is_active ? '' : ' checked') + '> Active</label>',
      function (d, m) { if (p.id) d.id = p.id; d.is_active = d.is_active ? 1 : 0; return API.call('ratePlans.save', d).then(function () { m.close(); toast('Saved.'); refresh(); }); });
  }
  Object.assign(MORE, { rpnew: function () { rpModal(); }, rpedit: function (b) { rpModal(S.rpPlans.filter(function (x) { return String(x.id) === b.getAttribute('data-id'); })[0]); } });


  // ----- expense actions, stock links, open orders -----
  Object.assign(MORE, {
    expok: function (b) { busy(b, function () { return API.call('expenses.approve', { id: Number(b.getAttribute('data-id')) }).then(function () { toast('Approved.'); refresh(); }); }); },
    expno: function (b) { var r = prompt('Reason for rejecting:'); if (r) busy(b, function () { return API.call('expenses.reject', { id: Number(b.getAttribute('data-id')), reason: r }).then(function () { toast('Rejected.'); refresh(); }); }); },
    exppay: function (b) {
      var id = Number(b.getAttribute('data-id'));
      simpleModal('Mark as paid', '<div class="f"><label>Paid by *</label><select name="payment_method_id">' + opts(S.methods, 'id', function (m) { return m.name; }) + '</select></div>', 'expenses.pay', { id: id });
    },
    stklinks: function () {
      API.call('stockLinks.list').then(function (d) {
        modal('Menu items and stock', '<p class="muted">Pick the stock item a menu item uses and how much one serving takes. Leave the item blank for no link.</p>' + table(['Menu', 'Item', 'Per serving', ''], d.menus.map(function (m, i) {
          return '<tr><td>' + esc(m.name) + '<div class="muted">' + (m.module === 'restaurant' ? 'Restaurant' : 'Room service') + '</div></td><td><select data-i="' + i + '" data-f="inv"><option value="">— none —</option>' + d.items.map(function (x) { return '<option value="' + x.id + '"' + (x.id === m.inventory_item_id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></td><td><input type="number" step="0.001" min="0" style="width:90px" data-i="' + i + '" data-f="qty" value="' + (m.quantity_per_serving || '') + '"></td><td><button class="sm" data-act="stksave" data-i="' + i + '">Save</button></td></tr>'; }), 'No menu items yet.'),
          function (m) { S.stkData = d; S.stkModal = m; });
      }).catch(fail);
    },
    stksave: function (b) {
      var i = b.getAttribute('data-i'), m = S.stkData.menus[Number(i)], root = S.stkModal.el;
      busy(b, function () { return API.call('stockLinks.save', { module: m.module, menu_item_id: m.menu_item_id, inventory_item_id: root.querySelector('select[data-i="' + i + '"]').value || '', quantity_per_serving: root.querySelector('input[data-i="' + i + '"]').value }).then(function () { toast('Saved.'); }); });
    },
    fuok: function (b) { fuModal(b, 'collected_outside'); },
    funo: function (b) { fuModal(b, 'written_off'); }
  });
  function fuModal(b, res) {
    var o = S.fuList[Number(b.getAttribute('data-i'))];
    simpleModal(res === 'written_off' ? 'Write off ' + o.order_number : 'Record ' + o.order_number + ' as collected', (res === 'collected_outside' ? '<div class="f"><label>Money received by *</label><select name="payment_method_id">' + opts(S.methods, 'id', function (m) { return m.name; }) + '</select></div>' : '') + '<div class="f"><label>Reason *</label><input name="reason" required placeholder="What happened?"></div>', 'followups.resolve', { outlet: o.outlet, order_id: o.order_id, resolution: res });
  }
  VIEWS.followups = function (v) {
    return API.call('followups.list').then(function (l) {
      S.fuList = l;
      v.innerHTML = '<div class="card"><h3>Orders left open</h3><p class="muted">Restaurant and room-service orders that were never settled: the guest has checked out, or the order is over a day old. Record the money if it was collected, or write the order off with a reason.</p>' +
        table(['Order', 'Outlet', 'Guest', '>Total', 'Status', 'Since', ''], l.map(function (o, i) { return '<tr><td>' + esc(o.order_number) + '</td><td>' + esc(o.outlet_label) + '</td><td>' + esc(o.guest_name) + (o.room_number ? '<div class="muted">Room ' + esc(o.room_number) + '</div>' : '') + '</td><td class="r">' + money(o.total) + '</td><td>' + pill(o.status) + '</td><td class="muted">' + esc(o.created_at) + '</td><td class="actions"><button class="sm" data-act="fuok" data-i="' + i + '">Collected</button> <button class="sm danger" data-act="funo" data-i="' + i + '">Write off</button></td></tr>'; }), 'Nothing is waiting. All orders are settled.') + '</div>';
    });
  };


  // ----- database health -----
  function shShow(h) {
    var pct = h.used_pct, col = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warn)' : 'var(--ok)';
    document.getElementById('shout').innerHTML = '<div class="kv"><b>Space used</b><span>' + pct + '% of ' + (h.cell_limit / 1e6) + ' million cells</span></div><div style="height:8px;background:var(--muted-bg);border-radius:4px;margin:4px 0 10px"><div style="height:8px;width:' + Math.min(100, pct) + '%;background:' + col + ';border-radius:4px"></div></div>' +
      '<div class="kv"><b>Nightly backup</b><span>' + (h.triggers ? (h.triggers.backup ? 'scheduled' : '<b style="color:var(--danger)">not scheduled</b>') : 'unknown') + '</span><b>Nightly clean-up</b><span>' + (h.triggers ? (h.triggers.cleanup ? 'scheduled' : '<b style="color:var(--danger)">not scheduled</b>') : 'unknown') + '</span><b>Archived audit entries</b><span>' + h.audit_archive_rows + '</span></div>' +
      (h.problems.length ? '<h4 style="margin-top:10px">Needs attention</h4><ul>' + h.problems.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="pill ok" style="display:inline-block;margin-top:8px">Everything looks healthy</p>') +
      '<details style="margin-top:8px"><summary>Per-sheet details</summary>' + table(['Sheet', '>Rows', 'Header', '>Blank rows', '>Cells reserved'], h.tables.map(function (t) { return '<tr><td>' + esc(t.name) + '</td><td class="r">' + t.rows + '</td><td>' + esc(t.header) + '</td><td class="r">' + t.blank_rows + '</td><td class="r">' + t.allocated.toLocaleString() + '</td></tr>'; })) + '</details><p class="muted">Checked ' + esc(h.checked_at) + '</p>';
  }
  function shRun(b, action, msg) {
    busy(b, function () { return API.call(action, {}).then(function (r) { toast(msg(r)); return API.call('sheets.health'); }).then(shShow); });
  }
  Object.assign(MORE, {
    shcheck: function (b) { busy(b, function () { return API.call('sheets.health').then(shShow); }); },
    shrepair: function (b) { shRun(b, 'sheets.repair', function (r) { return 'Repaired: ' + r.headers_fixed + ' header(s), ' + r.blank_rows_removed + ' blank row(s), ' + r.cells_released.toLocaleString() + ' cells released.'; }); },
    shclean: function (b) { shRun(b, 'sheets.maintain', function (r) { return 'Clean-up done: ' + r.sessions + ' old sign-ins, ' + r.retry_log + ' retry records, ' + r.audit_archived + ' audit entries archived.'; }); },
    shsched: function (b) { shRun(b, 'sheets.schedule', function (r) { return r.message; }); }
  });

  // ----- events -----
  VIEWS.events = function (v) {
    var tab = S.evTab || 'bookings', tabs = [['bookings', 'Bookings'], ['spaces', 'Spaces']];
    return Promise.all([API.call('events.list'), API.call('events.spaces')]).then(function (r) {
      var bk = r[0], sp = r[1]; S.evSp = sp;
      if (tab === 'spaces') v.innerHTML = tabBar('evtab', tab, tabs) + '<div class="card">' + (can('events.manage') ? '<button class="sm gold" data-act="evsnew" style="float:right">+ Add space</button>' : '') + '<h3>Event spaces</h3>' + table(['Space', '>Capacity', '>Hourly', '>Daily', 'Status', ''], sp.map(function (s) { return '<tr><td>' + esc(s.name) + '<div class="muted">' + esc(s.description) + '</div></td><td class="r">' + esc(s.capacity === null ? '' : s.capacity) + '</td><td class="r">' + (s.hourly_rate === null ? '—' : money(s.hourly_rate)) + '</td><td class="r">' + (s.daily_rate === null ? '—' : money(s.daily_rate)) + '</td><td>' + (s.is_active ? '<span class="pill ok">active</span>' : '<span class="pill">inactive</span>') + '</td><td class="actions">' + (can('events.manage') ? '<button class="sm sec" data-act="evsedit" data-id="' + s.id + '">Edit</button>' : '') + '</td></tr>'; }), 'No spaces yet.') + '</div>';
      else v.innerHTML = tabBar('evtab', tab, tabs) + '<div class="card">' + (can('events.transact') ? '<button class="sm gold" data-act="evnew" style="float:right">+ New booking</button>' : '') + '<h3>Event bookings</h3>' + table(['Booking', 'Client', 'Space', 'When', 'Status', '>Total', '>Balance', ''], bk.map(function (b) { return '<tr><td>' + esc(b.booking_number) + '</td><td>' + esc(b.client_name) + '<div class="muted">' + esc(b.client_company) + '</div></td><td>' + esc(b.space_name) + '</td><td>' + esc(b.event_date + (b.end_date ? ' → ' + b.end_date : '')) + '<div class="muted">' + esc(b.start_time + '–' + b.end_time) + '</div></td><td>' + pill(b.status) + '</td><td class="r">' + money(b.charges) + '</td><td class="r">' + (b.settlement_type === 'room_charge' ? '<span class="muted">room ' + esc(b.room_number) + '</span>' : money(b.balance)) + '</td><td class="actions"><button class="sm sec" data-act="evopen" data-id="' + b.id + '">Open</button></td></tr>'; }), 'No bookings yet.') + '</div>';
    });
  };
  function evModal(id) {
    if (S.evm) { S.evm.close(); S.evm = null; }
    Promise.all([API.call('events.get', { booking_id: id })]).then(function (r) {
      var b = r[0], tr = can('events.transact'), direct = b.settlement_type === 'direct', done = b.status === 'cancelled';
      var B = function (a, l, c, extra) { return '<button class="sm ' + (c || 'sec') + '" data-act="' + a + '" data-id="' + b.id + '" ' + (extra || '') + '>' + l + '</button> '; };
      S.evm = modal('Event ' + b.booking_number + ' — ' + b.client_name, '<div class="kv"><b>Space</b><span>' + esc(b.space_name) + '</span><b>When</b><span>' + esc(b.event_date + (b.end_date ? ' → ' + b.end_date : '') + ', ' + b.start_time + '–' + b.end_time) + '</span><b>Status</b><span>' + pill(b.status) + '</span>' + (b.purpose ? '<b>Purpose</b><span>' + esc(b.purpose) + '</span>' : '') + (b.client_phone ? '<b>Phone</b><span>' + esc(b.client_phone) + '</span>' : '') + '<b>Billing</b><span>' + (direct ? 'Billed directly' : 'Charged to room ' + esc(b.room_number)) + '</span></div>' +
        '<h4>Charges</h4>' + table(['Item', '>Qty', '>Price', '>Amount'], b.items.map(function (i) { return '<tr><td>' + esc(i.description) + '</td><td class="r">' + i.quantity + '</td><td class="r">' + money(i.unit_price) + '</td><td class="r">' + money(i.amount) + '</td></tr>'; })) +
        (direct ? '<h4>Payments</h4>' + table(['Receipt', 'Date', 'Method', '>Amount', ''], b.payments.map(function (p) { return '<tr><td>' + esc(p.payment_number) + '</td><td>' + esc(p.received_at.substr(0, 16)) + '</td><td>' + esc(p.method_name) + (p.amount < 0 ? ' <span class="muted">(' + esc(p.notes) + ')</span>' : '') + '</td><td class="r ' + (p.amount < 0 ? 'neg' : '') + '">' + money(p.amount) + '</td><td class="actions"><button class="sm sec" data-act="evrcpt" data-pay="' + p.id + '">Receipt</button>' + (tr && p.amount > 0 && p.status !== 'reversed' ? ' <button class="sm sec" data-act="evrev" data-id="' + b.id + '" data-pay="' + p.id + '">Reverse</button>' : '') + '</td></tr>'; }), 'No payments yet.') : '') +
        '<div class="kv" style="margin-top:8px"><b>Total</b><span>' + money(b.charges) + '</span>' + (direct ? '<b>Paid</b><span>' + money(b.paid) + '</span><b>Balance</b><span class="total">' + money(b.balance) + '</span>' : '') + '</div>' +
        (tr && !done ? '<div class="actions" style="margin-top:12px">' + (!b.folio_item_id ? B('evcharge', '+ Add charge') : '') + (direct && b.balance > 0 ? B('evpay', 'Take payment', 'gold') : '') + (!direct && !b.folio_item_id ? B('evroom', 'Charge to room', 'gold') : '') + '<select id="evst" style="width:auto" data-id="' + b.id + '">' + ['tentative', 'confirmed', 'in_progress', 'completed', 'cancelled'].map(function (s) { return '<option value="' + s + '"' + (s === b.status ? ' selected' : '') + '>' + s.replace('_', ' ') + '</option>'; }).join('') + '</select></div>' : (tr && done ? '<div class="actions" style="margin-top:12px"><select id="evst" style="width:auto" data-id="' + b.id + '"><option value="cancelled" selected>cancelled</option><option value="tentative">restore as tentative</option></select></div>' : '')),
        function (m) { var cl = m.close; m.close = function () { S.evm = null; cl(); }; var s = m.el.querySelector('#evst'); if (s) s.onchange = function () { API.call('events.status', { booking_id: id, status: s.value }).then(function () { toast('Status updated.'); evModal(id); refreshBehind(); }).catch(function (e) { fail(e); evModal(id); }); }; });
    }).catch(fail);
  }
  Object.assign(MORE, {
    evtab: function (b) { S.evTab = b.getAttribute('data-t'); refresh(); },
    evsnew: function () { evSpaceModal(); }, evsedit: function (b) { evSpaceModal(S.evSp.filter(function (x) { return String(x.id) === b.getAttribute('data-id'); })[0]); },
    evopen: function (b) { evModal(Number(b.getAttribute('data-id'))); },
    evnew: function () {
      var sp = S.evSp.filter(function (x) { return x.is_active; }); if (!sp.length) return toast('Add an event space first.', true);
      API.call('frontdesk.inHouse').then(function (inh) {
        formModal('New event booking', '<div class="row"><div class="f"><label>Space *</label><select name="event_space_id">' + opts(sp, 'id', function (x) { return x.name; }) + '</select></div><div class="f"><label>Client name *</label><input name="client_name" required></div></div><div class="row"><div class="f"><label>Phone</label><input name="client_phone"></div><div class="f"><label>Company</label><input name="client_company"></div></div>' +
          '<div class="row"><div class="f"><label>Date *</label><input type="date" name="event_date" required value="' + addDays(today(), 1) + '"></div><div class="f"><label>Last day (multi-day)</label><input type="date" name="end_date"></div><div class="f"><label>Start *</label><input type="time" name="start_time" required value="09:00"></div><div class="f"><label>End *</label><input type="time" name="end_time" required value="17:00"></div></div>' +
          '<div class="row"><div class="f"><label>Rate type</label><select name="rate_type"><option value="daily">Daily</option><option value="hourly">Hourly</option></select></div><div class="f"><label>Rate (empty = space rate)</label><input name="rate" type="number" step="0.01" min="0"></div><div class="f"><label>Attendees</label><input name="attendees" type="number" min="0"></div></div><div class="f"><label>Purpose</label><input name="purpose"></div>' +
          '<div class="f"><label>Billing</label><select name="settlement_type" id="est"><option value="direct">Bill the client directly</option><option value="room_charge">Charge to an in-house guest\'s room</option></select></div><div class="f" id="erm" style="display:none"><label>Room</label>' + inhSel(inh, 'folio_id') + '</div>',
          function (d, m) { if (d.settlement_type !== 'room_charge') d.folio_id = ''; return API.call('events.create', d).then(function (b) { m.close(); toast('Booked ' + b.booking_number + '.'); refresh(); evModal(b.id); }); });
        var s = document.getElementById('est'); s.onchange = function () { document.getElementById('erm').style.display = s.value === 'room_charge' ? '' : 'none'; };
      }).catch(fail);
    },
    evcharge: function (b) { var id = Number(b.getAttribute('data-id')); formModal('Add charge', '<div class="f"><label>Description *</label><input name="description" required placeholder="e.g. Catering, projector"></div><div class="row"><div class="f"><label>Quantity</label><input name="quantity" type="number" min="1" value="1"></div><div class="f"><label>Unit price *</label><input name="unit_price" type="number" step="0.01" min="0.01" required></div></div>', function (d, m) { d.booking_id = id; return API.call('events.addCharge', d).then(function () { m.close(); evModal(id); refreshBehind(); }); }); },
    evpay: function (b) { var id = Number(b.getAttribute('data-id')), key = uuid(); formModal('Take payment', '<div class="row"><div class="f"><label>Amount *</label><input name="amount" type="number" step="0.01" min="0.01" required></div><div class="f"><label>Method *</label>' + methodSel('payment_method_id', true) + '</div></div><div class="f"><label>Note</label><input name="notes" placeholder="e.g. deposit"></div>', function (d, m) { d.booking_id = id; d.idempotency_key = key; return API.call('events.pay', d).then(function (r) { m.close(); toast('Payment ' + r.payment_number + ' recorded.'); evModal(id); refreshBehind(); }); }); },
    evrev: function (b) { var id = Number(b.getAttribute('data-id')), pid = Number(b.getAttribute('data-pay')); formModal('Reverse payment', '<div class="f"><label>Amount to reverse *</label><input name="amount" type="number" step="0.01" min="0.01" required></div><div class="f"><label>Reason *</label><input name="reason" required></div>', function (d, m) { d.payment_id = pid; return API.call('events.payReverse', d).then(function () { m.close(); toast('Reversed.'); evModal(id); refreshBehind(); }); }); },
    evroom: function (b) { var id = Number(b.getAttribute('data-id')); if (confirm('Post the full booking total to the guest\'s room bill? No more charges can be added afterwards.')) busy(b, function () { return API.call('events.chargeToRoom', { booking_id: id }).then(function () { toast('Charged to room.'); evModal(id); refreshBehind(); }); }); },
    evrcpt: function (b) { API.call('events.receipt', { payment_id: Number(b.getAttribute('data-pay')) }).then(showReceipt).catch(fail); }
  });
  function evSpaceModal(x) { x = x || {}; formModal(x.id ? 'Edit space' : 'Add space', '<div class="f"><label>Name *</label><input name="name" required value="' + esc(x.name) + '"></div><div class="row"><div class="f"><label>Capacity</label><input name="capacity" type="number" min="0" value="' + esc(x.capacity === null ? '' : x.capacity) + '"></div><div class="f"><label>Hourly rate</label><input name="hourly_rate" type="number" step="0.01" min="0" value="' + esc(x.hourly_rate === null ? '' : x.hourly_rate) + '"></div><div class="f"><label>Daily rate</label><input name="daily_rate" type="number" step="0.01" min="0" value="' + esc(x.daily_rate === null ? '' : x.daily_rate) + '"></div></div><div class="f"><label>Description</label><input name="description" value="' + esc(x.description) + '"></div>' + (x.id ? '<label class="chk f"><input type="checkbox" name="is_active"' + (x.is_active ? ' checked' : '') + '> Active</label>' : ''), function (d, m) { if (x.id) d.id = x.id; return API.call('events.spaceSave', d).then(function () { m.close(); toast('Saved.'); refresh(); }); }); }

  // ----- accounting -----
  VIEWS.accounting = function (v) {
    var from = S.acFrom || today().slice(0, 8) + '01', to = S.acTo || today();
    return API.call('accounting.get', { from: from, to: to }).then(function (a) {
      function kv(o) { return Object.keys(o).sort().map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="r">' + money(o[k]) + '</td></tr>'; }); }
      v.innerHTML = '<div class="card"><form id="af" class="row" style="align-items:flex-end"><div class="f"><label>From</label><input type="date" name="from" value="' + a.from + '"></div><div class="f"><label>To</label><input type="date" name="to" value="' + a.to + '"></div><div class="f" style="flex:0 0 auto"><button type="submit">Show</button></div><div class="f" style="flex:0 0 auto"><button type="button" class="sec" onclick="window.print()">Print</button></div></form></div>' +
        '<div class="grid g4"><div class="stat"><span>Income</span><b>' + money(a.total_income) + '</b></div><div class="stat"><span>Expenses</span><b>' + money(a.total_expenses) + '</b></div><div class="stat"><span>Net profit</span><b class="' + (a.net < 0 ? 'neg' : '') + '">' + money(a.net) + '</b></div><div class="stat"><span>Owed to the hotel</span><b>' + money(a.total_receivable) + '</b></div></div>' +
        '<div class="grid g2" style="margin-top:16px"><div class="card"><h3>Income</h3>' + table(['Source', '>Amount'], kv(a.income), 'No income in this period.') + '</div><div class="card"><h3>Expenses</h3>' + table(['Category', '>Amount'], kv(a.expenses), 'No expenses in this period.') + '</div></div>' +
        '<div class="card"><h3>Accounts receivable <span class="muted" style="font-weight:400">— guest folios and event-client balances still owed (today)</span></h3>' + table(['Who', 'Reference', 'Detail', '>Balance'], a.receivables.map(function (r) { return '<tr><td>' + esc(r.who) + '</td><td>' + esc(r.ref) + '</td><td>' + esc(r.detail) + '</td><td class="r">' + money(r.balance) + '</td></tr>'; }), 'Nobody owes the hotel anything.') + '</div>' +
        (a.payables && a.payables.length ? '<div class="card"><h3>We owe (approved or waiting for approval) — ' + money(a.total_payable) + '</h3>' + table(['Ref', 'Payee', 'Detail', 'Status', '>Amount'], a.payables.map(function (r) { return '<tr><td>' + esc(r.ref) + '</td><td>' + esc(r.payee) + '</td><td>' + esc(r.detail) + '</td><td>' + esc(r.status) + '</td><td class="r">' + money(r.amount) + '</td></tr>'; })) + '</div>' : '') + '<p class="muted">Income counts charges posted to room bills (excluding tax), walk-in sales, walk-in car rentals and completed directly-billed events. Expenses count once they are paid.</p>' + footerHtml();
      v.querySelector('#af').onsubmit = function (e) { e.preventDefault(); S.acFrom = e.target.from.value; S.acTo = e.target.to.value; refresh(); };
    });
  };

  // ---------- click dispatch ----------
  var ACTS = {
    logout: function () { API.call('auth.logout').catch(function () {}).then(function () { API.setToken(''); S.user = null; return API.wipe(); }).then(function () { loginScreen(); }); },
    fdtab: function (b) { S.fdTab = b.getAttribute('data-tab'); refresh(); },
    checkin: function (b) { checkinModal(b.getAttribute('data-rr'), b.getAttribute('data-label')); },
    checkout: function (b) { checkoutModal(b.getAttribute('data-stay')); },
    folio: function (b) { folioModal(b.getAttribute('data-stay')); },
    nightaudit: function (b) { if (confirm('Post any room nights that have not been charged yet?')) busy(b, function () { return API.call('frontdesk.nightAudit').then(function (r) { toast(r.stays_updated + ' stay(s) updated.'); refresh(); }); }); },
    newres: function () { newReservation(); },
    resdates: function (b) {
      var id = Number(b.getAttribute('data-id'));
      modal('Change dates', '<form id="df"><div class="row"><div class="f"><label>Arrival</label><input type="date" name="arrival_date" value="' + esc(b.getAttribute('data-a')) + '"></div><div class="f"><label>Departure</label><input type="date" name="departure_date" value="' + esc(b.getAttribute('data-d')) + '"></div></div><div class="actions"><button type="submit">Save</button></div></form>', function (m) {
        m.el.querySelector('#df').onsubmit = function (e) { e.preventDefault(); var d = formData(e.target); d.id = id; busy(e.target.querySelector('button'), function () { return API.call('reservations.changeDates', d).then(function () { m.close(); toast('Dates changed.'); refresh(); }); }); };
      });
    },
    rescancel: function (b) { var reason = prompt('Reason for cancelling this reservation:'); if (reason) busy(b, function () { return API.call('reservations.cancel', { id: Number(b.getAttribute('data-id')), reason: reason }).then(function () { toast('Reservation cancelled.'); refresh(); }); }); },
    newguest: function () { guestModal(); },
    editguest: function (b) { guestModal((S.guestCache || []).filter(function (g) { return String(g.id) === b.getAttribute('data-id'); })[0]); },
    newroom: function () { roomModal(); },
    editroom: function (b) { roomModal(S.roomCache.filter(function (r) { return String(r.id) === b.getAttribute('data-id'); })[0]); },
    newtype: function () { typeModal(); },
    edittype: function (b) { typeModal(S.typeCache.filter(function (t) { return String(t.id) === b.getAttribute('data-id'); })[0]); },
    newuser: function () { userModal(); },
    edituser: function (b) { userModal(S.userCache.filter(function (u) { return String(u.id) === b.getAttribute('data-id'); })[0]); },
    resetpw: function (b) { var pw = prompt('New password for this user (8+ characters, letters and numbers):'); if (pw) busy(b, function () { return API.call('users.resetPassword', { id: Number(b.getAttribute('data-id')), password: pw }).then(function () { toast('Password reset. The user was signed out.'); }); }); },
    newrole: function () { roleModal(); },
    editrole: function (b) { roleModal(S.roleCache.filter(function (r) { return String(r.id) === b.getAttribute('data-id'); })[0]); },
    reptab: function (b) { S.repTab = b.getAttribute('data-tab'); refresh(); },
    rtab: function (b) { S.rtab = b.getAttribute('data-tab'); refresh(); },
    neworder: function () { newOrderModal(); },
    openorder: function (b) { orderModal(b.getAttribute('data-id')); },
    newmenu: function () { menuModal(); },
    editmenu: function (b) { menuModal(S.menuCache.items.filter(function (i) { return String(i.id) === b.getAttribute('data-id'); })[0]); },
    newtable: function () { simpleModal('Add table', '<div class="f"><label>Name *</label><input name="name" required placeholder="e.g. Table 5"></div>', 'restaurant.tableSave'); },
    edittable: function (b) { var t = S.menuCache.tables.filter(function (x) { return String(x.id) === b.getAttribute('data-id'); })[0]; simpleModal('Edit table', '<div class="f"><label>Name *</label><input name="name" required value="' + esc(t.name) + '"></div><label class="chk f"><input type="checkbox" name="is_active"' + (t.is_active ? ' checked' : '') + '> In use</label>', 'restaurant.tableSave', { id: t.id }); },
    newcat: function () { simpleModal('Add category', '<div class="f"><label>Name *</label><input name="name" required placeholder="e.g. Starters"></div>', 'restaurant.categorySave'); },
    outlettab: function (b) { S.outlet = b.getAttribute('data-o'); refresh(); },
    orcpt: function (b) { API.call('outlet.receipt', { outlet: S.outlet, sale_id: Number(b.getAttribute('data-id')) }).then(showReceipt).catch(fail); },
    newoitem: function () { outletItemModal(); },
    editoitem: function (b) { outletItemModal(S.outletItems.filter(function (i) { return String(i.id) === b.getAttribute('data-id'); })[0]); },
    newexpcat: function () { simpleModal('Add expense category', '<div class="f"><label>Name *</label><input name="name" required></div>', 'expenses.categorySave'); },
    newexp: function () {
      simpleModal('Record expense', '<div class="row"><div class="f"><label>Date</label><input type="date" name="expense_date" value="' + today() + '" required></div><div class="f"><label>Category *</label><select name="category_id">' + opts(S.expCats, 'id', function (c) { return c.name; }) + '</select></div></div><div class="row"><div class="f"><label>Payee *</label><input name="payee" required></div><div class="f"><label>Amount *</label><input name="amount" type="number" step="0.01" min="0.01" required></div></div><div class="f"><label>Description *</label><input name="description" required></div>' + (S.expNeed ? '<p class="muted">This will wait for approval before it counts as an expense.</p>' : '<div class="f"><label>Paid by</label><select name="payment_method_id">' + opts(S.methods, 'id', function (m) { return m.name; }) + '</select></div>'), 'expenses.create');
    },
    voidexp: function (b) { var r = prompt('Reason for voiding this expense:'); if (r) busy(b, function () { return API.call('expenses.void', { id: Number(b.getAttribute('data-id')), reason: r }).then(function () { toast('Expense voided.'); refresh(); }); }); },
    invtab: function (b) { S.invTab = b.getAttribute('data-t'); refresh(); },
    invfilter: function (b) { S.invFilter = b.getAttribute('data-f'); refresh(); },
    invmove: function (b) { invMoveModal(b.getAttribute('data-id')); },
    invitem: function (b) { invItemModal(b.getAttribute('data-id')); },
    invnew: function (b) { var k = b.getAttribute('data-k'); simpleModal('Add ' + k, '<div class="f"><label>Name *</label><input name="name" required></div>', 'inventory.' + k + 'Save'); },
    invedit: function (b) { var k = b.getAttribute('data-k'), x = S.inv[k + 's'].filter(function (r) { return String(r.id) === b.getAttribute('data-id'); })[0]; simpleModal('Edit ' + k, '<div class="f"><label>Name *</label><input name="name" required value="' + esc(x.name) + '"></div>', 'inventory.' + k + 'Save', { id: x.id }); },
    chgurl: function () { connectScreen(); },
    queue: function () { queueModal(); },
    syncnow: function (b) { busy(b, function () { return API.sync(); }); },
    reload: function () { location.reload(); }
  };
  Object.assign(ACTS, MORE);
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (b && ACTS[b.getAttribute('data-act')]) { e.preventDefault(); ACTS[b.getAttribute('data-act')](b); }
  });

  start();
})();
