/**
 * Db.gs - a tiny table layer over Google Sheets.
 * One sheet per table, row 1 = column names. Every column is stored as plain
 * text/number; typed on read using SCHEMA so dates never turn into Date objects.
 * All writes happen inside withLock_() so only one request mutates at a time.
 */
var SCHEMA = {
  hotels:           { cols: ['id','name','address','phone','email','currency_symbol','tax_enabled','tax_name','tax_rate','created_at'], num: ['id','tax_enabled','tax_rate'] },
  roles:            { cols: ['id','name','is_system','created_at'], num: ['id','is_system'] },
  role_permissions: { cols: ['id','role_id','permission_code'], num: ['id','role_id'] },
  users:            { cols: ['id','role_id','username','password_hash','salt','full_name','phone','is_active','last_login_at','failed_login_attempts','locked_until','created_at'], num: ['id','role_id','is_active','failed_login_attempts'] },
  sessions:         { cols: ['id','token_hash','user_id','created_at','expires_at'], num: ['id','user_id'] },
  room_types:       { cols: ['id','name','base_rate','max_occupancy','description','is_active'], num: ['id','base_rate','max_occupancy','is_active'] },
  rooms:            { cols: ['id','room_type_id','room_number','building','floor','status','notes','is_active','created_at'], num: ['id','room_type_id','is_active'] },
  guests:           { cols: ['id','guest_code','full_name','gender','phone','email','address','nationality','id_type','id_number','company_name','notes','created_at'], num: ['id'] },
  reservations:     { cols: ['id','reservation_number','guest_id','source','arrival_date','departure_date','status','special_requests','notes','created_by','created_at'], num: ['id','guest_id','created_by'] },
  reservation_rooms:{ cols: ['id','reservation_id','room_id','room_type_id','rate','original_rate','adults','children','status'], num: ['id','reservation_id','room_id','room_type_id','rate','original_rate','adults','children'] },
  rate_overrides:   { cols: ['id','reservation_room_id','original_rate','new_rate','reason','approved_by','created_at'], num: ['id','reservation_room_id','original_rate','new_rate','approved_by'] },
  stays:            { cols: ['id','reservation_room_id','room_id','guest_id','stay_number','rate','checkin_at','checkout_at','checked_in_by','checked_out_by','status'], num: ['id','reservation_room_id','room_id','guest_id','rate','checked_in_by','checked_out_by'] },
  folios:           { cols: ['id','stay_id','folio_number','status','opened_at','closed_at'], num: ['id','stay_id'] },
  folio_items:      { cols: ['id','folio_id','service_code','description','quantity','unit_amount','amount','reference_type','reference_id','created_by','created_at'], num: ['id','folio_id','quantity','unit_amount','amount','reference_id','created_by'] },
  payment_methods:  { cols: ['id','name','code','is_active'], num: ['id','is_active'] },
  payments:         { cols: ['id','folio_id','payment_number','receipt_number','payment_method_id','amount','status','reversed_payment_id','notes','received_by','received_at','idempotency_key'], num: ['id','folio_id','payment_method_id','amount','reversed_payment_id','received_by'] },
  numbering:        { cols: ['id','key_name','prefix','next_number','padding'], num: ['id','next_number','padding'] },
  restaurant_tables:     { cols: ['id','name','is_active'], num: ['id','is_active'] },
  restaurant_categories: { cols: ['id','name'], num: ['id'] },
  restaurant_menu_items: { cols: ['id','category_id','name','price','is_active'], num: ['id','category_id','price','is_active'] },
  restaurant_orders:     { cols: ['id','order_number','table_id','settlement_type','folio_id','guest_id','folio_item_id','status','payment_method_id','amount_paid','notes','created_by','created_at','settled_at'], num: ['id','table_id','folio_id','guest_id','folio_item_id','payment_method_id','amount_paid','created_by'] },
  restaurant_order_items:{ cols: ['id','order_id','menu_item_id','description','quantity','unit_price','amount'], num: ['id','order_id','menu_item_id','quantity','unit_price','amount'] },
  audit_logs:       { cols: ['id','user_id','action','module','record_type','record_id','old_value','new_value','reason','created_at'], num: ['id','user_id'] }
};

var Db = (function () {
  var ss_ = null;
  var cache_ = {};      // table -> { rows: [...], nextRow }
  var sheets_ = {};     // table -> Sheet object (avoids repeated lookups)

  function spreadsheet() {
    if (ss_) return ss_;
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (id) { ss_ = SpreadsheetApp.openById(id); return ss_; }
    ss_ = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss_) throw new Error('No database spreadsheet. Run setupDatabase() once from the Apps Script editor.');
    return ss_;
  }

  function sheetFor(name, create) {
    if (sheets_[name]) return sheets_[name];
    var ss = spreadsheet();
    var sh = ss.getSheetByName(name);
    if (!sh && create) {
      sh = ss.insertSheet(name);
      var cols = SCHEMA[name].cols;
      sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
      sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), cols.length).setNumberFormat('@');
      sh.setFrozenRows(1);
    }
    if (sh) sheets_[name] = sh;
    return sh;
  }

  function isNum(name, col) { return SCHEMA[name].num.indexOf(col) !== -1; }

  function coerce(name, col, v) {
    if (v === '' || v === null || v === undefined) return isNum(name, col) ? null : '';
    if (v instanceof Date) {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    }
    if (isNum(name, col)) { var n = Number(v); return isNaN(n) ? null : n; }
    return String(v);
  }

  function load(name) {
    if (cache_[name]) return cache_[name];
    var sh = sheetFor(name, true);
    var cols = SCHEMA[name].cols;
    var last = sh.getLastRow();
    var rows = [];
    if (last > 1) {
      var data = sh.getRange(2, 1, last - 1, cols.length).getValues();
      for (var i = 0; i < data.length; i++) {
        var o = { _row: i + 2 };
        for (var c = 0; c < cols.length; c++) o[cols[c]] = coerce(name, cols[c], data[i][c]);
        if (o.id === null || o.id === '') continue;
        rows.push(o);
      }
    }
    cache_[name] = { rows: rows, nextRow: last + 1 };
    return cache_[name];
  }

  function toArray(name, o) {
    var cols = SCHEMA[name].cols, out = [];
    for (var c = 0; c < cols.length; c++) {
      var v = o[cols[c]];
      out.push(v === null || v === undefined ? '' : v);
    }
    return out;
  }

  return {
    all: function (name) { return load(name).rows; },
    where: function (name, pred) {
      var rows = load(name).rows, out = [];
      for (var i = 0; i < rows.length; i++) {
        var ok = typeof pred === 'function' ? pred(rows[i]) : Object.keys(pred).every(function (k) { return rows[i][k] === pred[k]; });
        if (ok) out.push(rows[i]);
      }
      return out;
    },
    find: function (name, id) {
      var rows = load(name).rows;
      for (var i = 0; i < rows.length; i++) if (rows[i].id === Number(id)) return rows[i];
      return null;
    },
    findBy: function (name, pred) { var r = this.where(name, pred); return r.length ? r[0] : null; },
    insert: function (name, data) {
      var t = load(name), rows = t.rows, maxId = 0;
      for (var i = 0; i < rows.length; i++) if (rows[i].id > maxId) maxId = rows[i].id;
      var o = {};
      SCHEMA[name].cols.forEach(function (c) { o[c] = data[c] === undefined ? (isNum(name, c) ? null : '') : data[c]; });
      o.id = maxId + 1;
      if (SCHEMA[name].cols.indexOf('created_at') !== -1 && !o.created_at) o.created_at = nowStr_();
      var sh = sheetFor(name, true);
      var rowNo = t.nextRow;
      if (rowNo > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(500, rowNo - sh.getMaxRows()));
      sh.getRange(rowNo, 1, 1, SCHEMA[name].cols.length).setNumberFormat('@').setValues([toArray(name, o)]);
      o._row = rowNo; t.nextRow = rowNo + 1;
      rows.push(o);
      return o;
    },
    update: function (name, id, patch) {
      var o = this.find(name, id);
      if (!o) throw new Error('Record not found.');
      Object.keys(patch).forEach(function (k) { if (k !== 'id' && k !== '_row') o[k] = patch[k]; });
      var sh = sheetFor(name, true);
      sh.getRange(o._row, 1, 1, SCHEMA[name].cols.length).setNumberFormat('@').setValues([toArray(name, o)]);
      return o;
    },
    remove: function (name, id) {
      var o = this.find(name, id);
      if (!o) return;
      sheetFor(name, true).deleteRow(o._row);
      delete cache_[name];           // row numbers shifted: reload on next use
    },
    reset: function () { cache_ = {}; sheets_ = {}; ss_ = null; },
    ensureAll: function () { Object.keys(SCHEMA).forEach(function (n) { sheetFor(n, true); }); },
    spreadsheet: spreadsheet
  };
})();

function nowStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function todayStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** Run fn with the global script lock so concurrent users cannot interleave writes. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { Db.reset(); return fn(); } finally { lock.releaseLock(); }
}

/** Next document number (RES00001 ...). Call inside withLock_. */
function nextNumber_(key) {
  var defaults = { guest: 'G', restaurant_order: 'RST', reservation: 'RES', stay: 'STY', folio: 'FOL', payment: 'PAY', receipt: 'RCT' };
  var row = Db.findBy('numbering', { key_name: key });
  if (!row) row = Db.insert('numbering', { key_name: key, prefix: defaults[key] || key.substr(0, 3).toUpperCase(), next_number: 1, padding: 5 });
  var n = row.next_number;
  Db.update('numbering', row.id, { next_number: n + 1 });
  var s = String(n);
  while (s.length < row.padding) s = '0' + s;
  return row.prefix + '-' + s;
}

function audit_(user, action, module, recordType, recordId, oldV, newV, reason) {
  try {
    Db.insert('audit_logs', { user_id: user ? user.id : null, action: action, module: module || '', record_type: recordType || '',
      record_id: recordId === undefined ? '' : recordId, old_value: oldV === undefined || oldV === null ? '' : String(oldV),
      new_value: newV === undefined || newV === null ? '' : String(newV), reason: reason || '', created_at: nowStr_() });
  } catch (e) { /* auditing must never break the action */ }
}

function round2_(n) { return Math.round((Number(n) + 1e-9) * 100) / 100; }
