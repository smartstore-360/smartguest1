/* SmartGuest front end - plain JavaScript, no build step. Works inside Apps Script and on GitHub Pages. */
(function () {
  'use strict';
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

  // ---------- shell ----------
  var PAGES = [
    ['dashboard', 'Dashboard', 'frontdesk.view'], ['frontdesk', 'Front Desk', 'frontdesk.view'], ['reservations', 'Reservations', 'reservations.view'],
    ['guests', 'Guests', 'guests.view'], ['rooms', 'Rooms', 'rooms.view'], ['housekeeping', 'Housekeeping', 'housekeeping.view'], ['restaurant', 'Restaurant', 'restaurant.view'], ['outlets', 'Services & Shops', ['bar.view', 'gift_shop.view', 'business_centre.view', 'salon.view', 'spa.view', 'laundry.view', 'gym.view', 'pool.view', 'parking.view', 'transport.view']], ['inventory', 'Inventory', 'inventory.view'], ['expenses', 'Expenses', 'expenses.view'],
    ['reports', 'Reports', 'reports.view'], ['users', 'Users & Roles', 'users.manage'], ['settings', 'Settings', null], ['audit', 'Audit Log', 'audit.view']
  ];
  function allowedPages() { return PAGES.filter(function (p) { return !p[2] || (Array.isArray(p[2]) ? p[2].some(can) : can(p[2])); }); }

  function render() {
    var pages = allowedPages();
    if (!pages.some(function (p) { return p[0] === S.route; })) S.route = pages.length ? pages[0][0] : 'settings';
    $app.innerHTML = '<div class="shell"><aside class="side"><div class="brand">SmartGuest<small>Hotel Management System</small></div><div class="hotelname">' + esc(S.hotel ? S.hotel.name : '') + '</div><nav class="nav">' +
      pages.map(function (p) { return '<a href="#' + p[0] + '" class="' + (p[0] === S.route ? 'on' : '') + '">' + esc(p[1]) + '</a>'; }).join('') +
      '</nav></aside><main class="main"><div class="top"><h2 id="title"></h2><span class="who">' + esc(S.user.full_name) + ' · ' + esc(S.user.role) + '</span><button class="sec sm" data-act="logout">Sign out</button></div><div id="view"></div></main></div>';
    var p = PAGES.filter(function (x) { return x[0] === S.route; })[0];
    document.getElementById('title').textContent = p ? p[1] : '';
    document.title = (p ? p[1] + ' · ' : '') + 'SmartGuest';
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

  function loginScreen(msg) {
    $app.innerHTML = '<div class="login"><div class="brand">SmartGuest<small>Hotel Management System</small></div><div class="card"><form id="lf"><div class="f"><label>Username</label><input name="username" autocomplete="username" required autofocus></div><div class="f"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div><div class="err" id="le">' + esc(msg || '') + '</div><button type="submit" style="width:100%">Sign in</button></form>' + (API.inGas ? '' : '<p class="muted" style="margin:12px 0 0;font-size:.8rem">Server: ' + esc(API.getUrl()) + ' · <a href="#" id="chg">change</a></p>') + '</div></div>';
    var chg = document.getElementById('chg'); if (chg) chg.onclick = function (e) { e.preventDefault(); connectScreen(); };
    document.getElementById('lf').onsubmit = function (e) {
      e.preventDefault(); var f = e.target, b = f.querySelector('button'); b.disabled = true; document.getElementById('le').textContent = '';
      API.call('auth.login', { username: f.username.value, password: f.password.value }).then(function (d) { API.setToken(d.token); S.user = d.user; return boot(); })
        .catch(function (err) { if (err.message === 'NO_URL') return connectScreen(); document.getElementById('le').textContent = err.message; b.disabled = false; });
    };
  }

  function boot() {
    return Promise.all([API.call('hotel.get'), API.call('payments.methods')]).then(function (r) {
      S.hotel = r[0]; S.methods = r[1]; S.route = location.hash.slice(1) || 'dashboard'; render();
    });
  }
  function start() {
    if (API.needsUrl()) return connectScreen();
    if (!API.token()) return loginScreen();
    API.call('auth.me').then(function (u) { S.user = u; return boot(); }).catch(function (e) { if (e.message === 'NO_URL') return connectScreen(); loginScreen(e.message && !/session/i.test(e.message) ? 'Could not reach the server: ' + e.message : ''); });
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
      on('#pf', function (d) { d.folio_id = f.folio.id; d.idempotency_key = key; key = uuid(); return API.call('payments.receive', d).then(function (r) { toast('Payment received — receipt ' + r.receipt_number); }); });
      on('#cf2', function (d) { d.folio_id = f.folio.id; return API.call('folio.addCharge', d).then(function () { toast('Charge added.'); }); });
      on('#df', function (d) { d.folio_id = f.folio.id; return API.call('folio.discount', d).then(function () { toast('Discount applied.'); }); });
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-rcpt]'), function (b) { b.onclick = function () { API.call('receipt.payment', { payment_id: Number(b.getAttribute('data-rcpt')) }).then(showReceipt).catch(fail); }; });
      var inv = m.el.querySelector('[data-invoice]'); if (inv) inv.onclick = function () { showReceipt({ kind: 'invoice', folio: f, copies: [''], printed_by: S.user.full_name, printed_at: new Date().toLocaleString(), hotel: S.hotel }); };
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-rev]'), function (b) {
        b.onclick = function () {
          var amt = prompt('Amount to reverse (max ' + b.getAttribute('data-max') + '):', b.getAttribute('data-max')); if (amt === null) return;
          var reason = prompt('Reason for the reversal:'); if (!reason) return;
          busy(b, function () { return API.call('payments.reverse', { payment_id: Number(b.getAttribute('data-rev')), amount: amt, reason: reason }).then(function () { toast('Payment reversed.'); reload(); }); });
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
      var upd = can('housekeeping.update'), statuses = ['available', 'dirty', 'cleaning', 'clean', 'inspected', 'maintenance', 'out_of_service', 'blocked'];
      v.innerHTML = '<div class="roomgrid">' + rooms.map(function (r) {
        var locked = r.status === 'occupied' || r.status === 'reserved' && false;
        return '<div class="rc"><b>' + esc(r.room_number) + '</b> <span class="muted">' + esc(r.room_type) + '</span><div style="margin:6px 0">' + pill(r.status) + '</div>' + (r.guest_name ? '<div class="muted" style="font-size:.8rem">' + esc(r.guest_name) + '</div>' : '') +
          (upd && !r.stay_id ? '<select data-room="' + r.id + '">' + statuses.map(function (s) { return '<option value="' + s + '"' + (s === r.status ? ' selected' : '') + '>' + s.replace(/_/g, ' ') + '</option>'; }).join('') + (statuses.indexOf(r.status) === -1 ? '<option selected>' + esc(r.status) + '</option>' : '') + '</select>' : '') + '</div>';
      }).join('') + '</div>';
      v.querySelectorAll('[data-room]').forEach(function (s) { s.onchange = function () { s.disabled = true; API.call('housekeeping.setStatus', { room_id: Number(s.getAttribute('data-room')), status: s.value }).then(function () { toast('Room updated.'); refresh(); }).catch(function (e) { fail(e); refresh(); }); }; });
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
    var keys = Object.keys(OUTLET_LABELS).filter(function (k) { return can(k + '.view'); });
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
          busy(e.target.querySelector('button[type=submit]'), function () { return API.call('outlet.sell', payload).then(function (res) { S.cart[cur] = []; toast('Sale ' + res.sale_number + ' completed.'); refresh(); return API.call('outlet.receipt', { outlet: cur, sale_id: res.id }).then(showReceipt); }); });
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
      var setup = '<div class="grid g2"><div class="card"><h3>Stores <button class="sm gold" data-act="invnew" data-k="store" style="float:right">+ Add</button></h3>' + table(['Store', ''], d.stores.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="actions"><button class="sm sec" data-act="invedit" data-k="store" data-id="' + x.id + '">Edit</button></td></tr>'; }), 'No stores yet.') + '</div>' +
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
        '<div class="kv" style="margin-bottom:10px"><b>Total (excluding voided)</b><span class="total">' + money(d.total) + '</span></div>' +
        table(['Number', 'Date', 'Category', 'Payee', 'Description', '>Amount', 'Status', ''], d.expenses.map(function (e) {
          return '<tr><td>' + esc(e.expense_number) + '</td><td>' + esc(e.expense_date) + '</td><td>' + esc(e.category) + '</td><td>' + esc(e.payee) + '</td><td>' + esc(e.description) + '<div class="muted">' + esc(e.method_name) + '</div></td><td class="r">' + money(e.amount) + '</td><td>' + (e.status === 'void' ? '<span class="pill bad" title="' + esc(e.void_reason) + '">void</span>' : '<span class="pill ok">paid</span>') + '</td><td class="actions">' + (e.status === 'paid' && can('expenses.void') ? '<button class="sm danger" data-act="voidexp" data-id="' + e.id + '">Void</button>' : '') + '</td></tr>'; }), 'No expenses in this period.') + '</div>';
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
    var h = d.hotel || S.hotel || {}, head = '<div class="rc-head"><b>' + esc(h.name) + '</b><div class="muted">' + esc([h.address, h.phone].filter(Boolean).join(' · ')) + '</div></div>', sheets;
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
      '<div class="card"><h3>Change my password</h3><form id="pw"><div class="row"><div class="f"><label>Current password</label><input type="password" name="current_password" required autocomplete="current-password"></div><div class="f"><label>New password</label><input type="password" name="new_password" required autocomplete="new-password"></div></div><div class="actions"><button type="submit">Change password</button></div></form></div>' +
      (API.inGas ? '' : '<div class="card"><h3>Server</h3><p class="muted" style="word-break:break-all">' + esc(API.getUrl()) + '</p><button class="sec sm" data-act="chgurl">Change server URL</button></div>');
    var hf = v.querySelector('#hf'); if (hf) hf.onsubmit = function (e) { e.preventDefault(); busy(e.target.querySelector('button'), function () { return API.call('hotel.save', formData(e.target)).then(function (r) { S.hotel = r; toast('Hotel saved.'); refresh(); }); }); };
    v.querySelector('#pw').onsubmit = function (e) { e.preventDefault(); var f = e.target; busy(f.querySelector('button'), function () { return API.call('auth.changePassword', formData(f)).then(function () { f.reset(); toast('Password changed. Other devices were signed out.'); }); }); };
    return Promise.resolve();
  };
  VIEWS.audit = function (v) {
    return API.call('audit.list', { limit: 300 }).then(function (rows) {
      v.innerHTML = '<div class="card">' + table(['When', 'User', 'Action', 'Record', 'Detail'], rows.map(function (r) { return '<tr><td class="muted" style="white-space:nowrap">' + esc(r.created_at) + '</td><td>' + esc(r.username) + '</td><td>' + esc(r.action) + '</td><td>' + esc(r.record_type) + ' ' + esc(r.record_id) + '</td><td>' + esc([r.old_value, r.new_value].filter(Boolean).join(' → ')) + (r.reason ? ' <span class="muted">· ' + esc(r.reason) + '</span>' : '') + '</td></tr>'; }), 'No activity yet.') + '</div>';
    });
  };

  // ---------- click dispatch ----------
  var ACTS = {
    logout: function () { API.call('auth.logout').catch(function () {}).then(function () { API.setToken(''); S.user = null; loginScreen(); }); },
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
      simpleModal('Record expense', '<div class="row"><div class="f"><label>Date</label><input type="date" name="expense_date" value="' + today() + '" required></div><div class="f"><label>Category *</label><select name="category_id">' + opts(S.expCats, 'id', function (c) { return c.name; }) + '</select></div></div><div class="row"><div class="f"><label>Payee *</label><input name="payee" required></div><div class="f"><label>Amount *</label><input name="amount" type="number" step="0.01" min="0.01" required></div></div><div class="f"><label>Description *</label><input name="description" required></div><div class="f"><label>Paid by</label><select name="payment_method_id">' + opts(S.methods, 'id', function (m) { return m.name; }) + '</select></div>', 'expenses.create');
    },
    voidexp: function (b) { var r = prompt('Reason for voiding this expense:'); if (r) busy(b, function () { return API.call('expenses.void', { id: Number(b.getAttribute('data-id')), reason: r }).then(function () { toast('Expense voided.'); refresh(); }); }); },
    invtab: function (b) { S.invTab = b.getAttribute('data-t'); refresh(); },
    invfilter: function (b) { S.invFilter = b.getAttribute('data-f'); refresh(); },
    invmove: function (b) { invMoveModal(b.getAttribute('data-id')); },
    invitem: function (b) { invItemModal(b.getAttribute('data-id')); },
    invnew: function (b) { var k = b.getAttribute('data-k'); simpleModal('Add ' + k, '<div class="f"><label>Name *</label><input name="name" required></div>', 'inventory.' + k + 'Save'); },
    invedit: function (b) { var k = b.getAttribute('data-k'), x = S.inv[k + 's'].filter(function (r) { return String(r.id) === b.getAttribute('data-id'); })[0]; simpleModal('Edit ' + k, '<div class="f"><label>Name *</label><input name="name" required value="' + esc(x.name) + '"></div>', 'inventory.' + k + 'Save', { id: x.id }); },
    chgurl: function () { connectScreen(); }
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (b && ACTS[b.getAttribute('data-act')]) { e.preventDefault(); ACTS[b.getAttribute('data-act')](b); }
  });

  start();
})();
