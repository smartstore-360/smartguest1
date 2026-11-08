/** Auth.gs - passwords, login lockout, session tokens, permissions. */

var SESSION_HOURS = 12;
var MAX_FAILED = 5;
var LOCK_MINUTES = 15;
var HASH_ROUNDS = 1000;

var PERMISSIONS = [
  ['rooms.view','View rooms and room types'], ['rooms.manage','Create/edit rooms and room types'],
  ['guests.view','View guest records'], ['guests.manage','Create/edit guest records'],
  ['reservations.view','View reservations'], ['reservations.create','Create new reservations'],
  ['reservations.edit','Modify/cancel reservations'], ['reservations.override_rate','Apply special room rates'],
  ['frontdesk.view','View Front Desk'], ['frontdesk.checkin','Check guests in'], ['frontdesk.checkout','Check guests out'],
  ['frontdesk.override_unavailable','Override room-unavailable block at check-in'],
  ['housekeeping.view','View housekeeping board'], ['housekeeping.update','Update room cleaning status'],
  ['folio.view','View guest folios'], ['folio.add_charge','Add manual charges'], ['folio.discount','Apply discounts'],
  ['payments.receive','Receive guest payments'], ['payments.reverse','Reverse/refund a payment'],
  ['payments.checkout_with_balance','Allow checkout with an outstanding balance'],
  ['users.manage','Create/edit users'], ['roles.manage','Create/edit roles and permissions'],
  ['settings.manage','Change hotel settings'], ['invoicing.print','Print receipts and invoices'],
  ['restaurant.view','View restaurant orders, tables and menu'], ['restaurant.manage','Manage menu, categories and tables'], ['restaurant.transact','Take, send, settle and cancel restaurant orders'], ['reports.view','View reports'], ['audit.view','View the audit log']
];

function bytesToHex_(bytes) {
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}
function sha256_(s) { return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }

function newSalt_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

function hashPassword_(password, salt) {
  var h = sha256_(salt + ':' + password);
  for (var i = 0; i < HASH_ROUNDS; i++) h = sha256_(h + salt + password);
  return h;
}

function constEq_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function validatePassword_(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new Error('Password must be at least 8 characters.');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new Error('Password must contain letters and numbers.');
}

function parseTs_(s) { return s ? new Date(String(s).replace(' ', 'T')).getTime() : 0; }

/** Returns { token, user } or throws a generic error. */
function login_(username, password) {
  username = String(username || '').trim().toLowerCase();
  password = String(password || '');
  var user = Db.findBy('users', function (u) { return u.username.toLowerCase() === username; });
  var generic = 'Invalid username or password.';

  if (!user) { hashPassword_(password, 'x'); throw new Error(generic); }   // equal-time dummy work
  if (!user.is_active) { hashPassword_(password, user.salt); throw new Error(generic); }
  if (user.locked_until && parseTs_(user.locked_until) > Date.now()) {
    throw new Error('Too many failed attempts. Try again in a few minutes.');
  }

  var ok = constEq_(hashPassword_(password, user.salt), user.password_hash);
  if (!ok) {
    var fails = (user.failed_login_attempts || 0) + 1;
    var patch = { failed_login_attempts: fails };
    if (fails >= MAX_FAILED) {
      patch.failed_login_attempts = 0;
      patch.locked_until = Utilities.formatDate(new Date(Date.now() + LOCK_MINUTES * 60000), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    }
    Db.update('users', user.id, patch);
    audit_(user, 'login_failed', 'security', 'users', user.id);
    throw new Error(generic);
  }

  Db.update('users', user.id, { failed_login_attempts: 0, locked_until: '', last_login_at: nowStr_() });
  purgeSessions_();
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  Db.insert('sessions', {
    token_hash: sha256_(token), user_id: user.id, created_at: nowStr_(),
    expires_at: Utilities.formatDate(new Date(Date.now() + SESSION_HOURS * 3600000), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
  });
  audit_(user, 'login', 'security', 'users', user.id);
  return { token: token, user: user };
}

function purgeSessions_() {
  var now = Date.now();
  Db.where('sessions', function (s) { return parseTs_(s.expires_at) < now; }).slice().reverse().forEach(function (s) { Db.remove('sessions', s.id); });
}

/** Resolve a token to { user, perms:{code:true} } or null. Disabled users are signed out. */
function authenticate_(token) {
  if (!token || typeof token !== 'string') return null;
  var h = sha256_(token);
  var s = Db.findBy('sessions', { token_hash: h });
  if (!s || parseTs_(s.expires_at) < Date.now()) return null;
  var user = Db.find('users', s.user_id);
  if (!user || !user.is_active) return null;
  var perms = {};
  var role = Db.find('roles', user.role_id);
  if (role && role.is_system) PERMISSIONS.forEach(function (p) { perms[p[0]] = true; });   // Super Administrator always has every permission, including ones added later
  else Db.where('role_permissions', { role_id: user.role_id }).forEach(function (rp) { perms[rp.permission_code] = true; });
  return { user: user, perms: perms, role: role, sessionId: s.id };
}

function logout_(ctx) { if (ctx && ctx.sessionId) Db.remove('sessions', ctx.sessionId); }

function publicUser_(ctx) {
  return { id: ctx.user.id, username: ctx.user.username, full_name: ctx.user.full_name,
           role: ctx.role ? ctx.role.name : '', permissions: Object.keys(ctx.perms) };
}

function requirePerm_(ctx, code) {
  if (!ctx.perms[code]) { audit_(ctx.user, 'access_denied', 'security', 'permission', '', '', code); throw new Error('You do not have permission to do that (' + code + ').'); }
}
