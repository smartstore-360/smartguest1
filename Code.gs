/**
 * Code.gs - entry points and the action router.
 * The SAME handler serves both clients:
 *   - Apps Script web app page  -> google.script.run.rpc(requestJson)
 *   - GitHub Pages (or any site) -> fetch(WEB_APP_URL, {method:'POST', body: requestJson})
 * Request:  { action: 'rooms.list', token: '...', args: {...} }
 * Response: { ok: true, data: ... }  or  { ok: false, error: 'message' }
 */

// action -> { perm: required permission (null = any signed-in user), write: needs lock, fn }
var ACTIONS = {
  'auth.login':     { pub: true, write: true, fn: function (ctx, a) { var r = login_(a.username, a.password); var c = authenticate_(r.token); return { token: r.token, user: publicUser_(c) }; } },
  'auth.logout':    { write: true, fn: function (ctx) { logout_(ctx); return true; } },
  'auth.me':        { fn: function (ctx) { return publicUser_(ctx); } },
  'auth.changePassword': { write: true, fn: changeOwnPassword_ },

  'dashboard.get':  { perm: 'frontdesk.view', fn: function () { return dashboard_(); } },

  'rooms.list':     { perm: 'rooms.view', fn: function () { return roomsList_(); } },
  'rooms.available':{ perm: 'reservations.view', fn: function (c, a) { return availableRooms_(a); } },
  'rooms.save':     { perm: 'rooms.manage', write: true, fn: roomSave_ },
  'roomTypes.list': { perm: 'rooms.view', fn: function () { return cleanAll_(Db.all('room_types')); } },
  'roomTypes.save': { perm: 'rooms.manage', write: true, fn: roomTypeSave_ },

  'guests.list':    { perm: 'guests.view', fn: function (c, a) { return guestsList_(a); } },
  'guests.save':    { perm: 'guests.manage', write: true, fn: guestSave_ },

  'reservations.list':       { perm: 'reservations.view', fn: function (c, a) { return reservationsList_(a); } },
  'reservations.create':     { perm: 'reservations.create', write: true, fn: reservationCreate_ },
  'reservations.cancel':     { perm: 'reservations.edit', write: true, fn: reservationCancel_ },
  'reservations.changeDates':{ perm: 'reservations.edit', write: true, fn: reservationChangeDates_ },
  'reservations.reassign':   { perm: 'reservations.edit', write: true, fn: reservationReassign_ },

  'frontdesk.arrivals': { perm: 'frontdesk.view', fn: function () { return arrivals_(); } },
  'frontdesk.inHouse':  { perm: 'frontdesk.view', fn: function () { return inHouse_(); } },
  'frontdesk.checkIn':  { perm: 'frontdesk.checkin', write: true, fn: checkIn_ },
  'frontdesk.checkoutPreview': { perm: 'frontdesk.checkout', fn: function (c, a) { return checkoutPreview_(a); } },
  'frontdesk.checkOut': { perm: 'frontdesk.checkout', write: true, fn: checkOut_ },
  'frontdesk.nightAudit': { perm: 'frontdesk.checkout', write: true, fn: function (c) { return nightAudit_(c); } },

  'folio.get':      { perm: 'folio.view', fn: function (c, a) { return folioView_(a); } },
  'folio.addCharge':{ perm: 'folio.add_charge', write: true, fn: function (c, a) { return { id: addCharge_(c, Number(a.folio_id), 'manual', str_(a.description), int_(a.quantity === undefined || a.quantity === '' || a.quantity === null ? 1 : a.quantity, 'Quantity'), a.unit_amount) }; } },
  'folio.discount': { perm: 'folio.discount', write: true, fn: function (c, a) { return { id: addCharge_(c, Number(a.folio_id), 'discount', str_(a.description) || 'Discount', 1, -Math.abs(Number(a.amount))) }; } },

  'payments.methods': { fn: function () { return cleanAll_(Db.where('payment_methods', { is_active: 1 })); } },
  'payments.receive': { perm: 'payments.receive', write: true, fn: paymentReceive_ },
  'payments.reverse': { perm: 'payments.reverse', write: true, fn: paymentReverse_ },

  'housekeeping.board':  { perm: 'housekeeping.view', fn: function () { return housekeepingBoard_(); } },
  'housekeeping.setStatus': { perm: 'housekeeping.update', write: true, fn: setRoomStatus_ },

  'restaurant.menu':   { perm: 'restaurant.view', fn: function () { return restaurantMenu_(); } },
  'restaurant.tableSave':   { perm: 'restaurant.manage', write: true, fn: restTableSave_ },
  'restaurant.categorySave':{ perm: 'restaurant.manage', write: true, fn: restCategorySave_ },
  'restaurant.menuSave':    { perm: 'restaurant.manage', write: true, fn: restMenuSave_ },
  'restaurant.orders':      { perm: 'restaurant.view', fn: function (c, a) { return restOrders_(a); } },
  'restaurant.order':       { perm: 'restaurant.view', fn: function (c, a) { var o = Db.find('restaurant_orders', a.order_id); if (!o) throw new Error('Order not found.'); return orderView_(o, true); } },
  'restaurant.create':      { perm: 'restaurant.transact', write: true, fn: restOrderCreate_ },
  'restaurant.addItem':     { perm: 'restaurant.transact', write: true, fn: restAddItem_ },
  'restaurant.removeItem':  { perm: 'restaurant.transact', write: true, fn: restRemoveItem_ },
  'restaurant.send':        { perm: 'restaurant.transact', write: true, fn: restSend_ },
  'restaurant.served':      { perm: 'restaurant.transact', write: true, fn: restServed_ },
  'restaurant.cancel':      { perm: 'restaurant.transact', write: true, fn: restCancel_ },
  'restaurant.settle':      { perm: 'restaurant.transact', write: true, fn: restSettle_ },
  'receipt.outlet':  { perm: 'restaurant.view', fn: outletReceipt_ },
  'receipt.payment': { perm: 'invoicing.print', fn: paymentReceipt_ },
  'reports.monthly': { perm: 'reports.view', fn: function (c, a) { return monthlyReport_(a); } },
  'reports.get':    { perm: 'reports.view', fn: function (c, a) { return report_(a); } },

  'users.list':     { perm: 'users.manage', fn: function () { return usersList_(); } },
  'users.save':     { perm: 'users.manage', write: true, fn: userSave_ },
  'users.resetPassword': { perm: 'users.manage', write: true, fn: userResetPassword_ },
  'roles.list':     { perm: 'users.manage', fn: function () { return rolesList_(); } },
  'roles.save':     { perm: 'roles.manage', write: true, fn: roleSave_ },
  'permissions.list': { perm: 'roles.manage', fn: function () { return PERMISSIONS.map(function (p) { return { code: p[0], description: p[1] }; }); } },
  'hotel.get':      { fn: function () { return clean_(hotel_()); } },
  'hotel.save':     { perm: 'settings.manage', write: true, fn: hotelSave_ },
  'audit.list':     { perm: 'audit.view', fn: function (c, a) { return auditList_(a); } }
};

function handle_(request) {
  var def = ACTIONS[request && request.action];
  if (!def) return { ok: false, error: 'Unknown action.' };
  var run = function () {
    var ctx = null;
    if (!def.pub) {
      ctx = authenticate_(request.token);
      if (!ctx) return { ok: false, error: 'Your session has expired. Please sign in again.', code: 'AUTH' };
      if (def.perm) requirePerm_(ctx, def.perm);
    }
    return { ok: true, data: def.fn(ctx, request.args || {}) };
  };
  try {
    if (def.write) return withLock_(run);
    Db.reset();
    return run();
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Something went wrong.' };
  }
}

function parse_(text) {
  try { var r = JSON.parse(text); return (r && typeof r === 'object') ? r : {}; } catch (e) { return {}; }
}

/** Called by google.script.run from the Apps Script-hosted page. */
function rpc(requestJson) { return handle_(parse_(requestJson)); }

/** GitHub Pages / any origin: POST a JSON string (send as text/plain to avoid a CORS preflight). */
function doPost(e) {
  var out = handle_(parse_(e && e.postData ? e.postData.contents : ''));
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Serves the app itself, or a tiny health check for the GitHub Pages "connect" screen. */
function doGet(e) {
  if (e && e.parameter && e.parameter.ping) {
    return ContentService.createTextOutput(JSON.stringify({ ok: true, app: 'SmartGuest' })).setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('SmartGuest')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}
