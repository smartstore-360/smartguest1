/** Services.gs - business rules ported from the PHP app. Every function runs inside withLock_ when it writes. */

// ---------- helpers ----------
function clean_(o) { if (!o) return o; var c = {}; Object.keys(o).forEach(function (k) { if (k !== '_row' && k !== 'password_hash' && k !== 'salt') c[k] = o[k]; }); return c; }
function cleanAll_(a) { return a.map(clean_); }
function str_(v) { return v === undefined || v === null ? '' : String(v).trim(); }
function need_(v, label) { var s = str_(v); if (!s) throw new Error(label + ' is required.'); return s; }
function int_(v, label) { var n = Number(v); if (!isFinite(n) || Math.floor(n) !== n) throw new Error(label + ' must be a whole number.'); return n; }

function isDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}
function dayNum_(s) { var p = String(s).substr(0, 10).split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000); }

var MONEY_MAX = 99999999.99;
function money_(v, label) {
  var n = Number(v);
  if (!isFinite(n)) throw new Error(label + ' is not a valid number.');
  n = round2_(n);
  if (Math.abs(n) > MONEY_MAX) throw new Error(label + ' is too large.');
  return n;
}
function positiveMoney_(v, label) { var n = money_(v, label); if (n < 0.01) throw new Error(label + ' must be greater than zero.'); return n; }

function hotel_() { return Db.all('hotels')[0]; }
function nightsElapsed_(checkinAt) { return Math.max(1, dayNum_(todayStr_()) - dayNum_(checkinAt)); }

// ---------- rooms ----------
function roomsList_() {
  var types = {}; Db.all('room_types').forEach(function (t) { types[t.id] = t; });
  var active = {}; Db.where('stays', { status: 'active' }).forEach(function (s) { active[s.room_id] = s; });
  var guests = {}; Db.all('guests').forEach(function (g) { guests[g.id] = g; });
  return Db.all('rooms').map(function (r) {
    var o = clean_(r), t = types[r.room_type_id];
    o.room_type = t ? t.name : ''; o.rate = t ? t.base_rate : 0; o.max_occupancy = t ? t.max_occupancy : 0;
    var st = active[r.id];
    if (st) { o.stay_id = st.id; o.guest_name = guests[st.guest_id] ? guests[st.guest_id].full_name : ''; }
    return o;
  }).sort(function (a, b) { return a.room_number.localeCompare(b.room_number, undefined, { numeric: true }); });
}

function roomTypeSave_(ctx, a) {
  var name = need_(a.name, 'Room type name');
  var rate = money_(a.base_rate, 'Base rate'); if (rate < 0) throw new Error('Base rate cannot be negative.');
  var occ = int_(a.max_occupancy, 'Maximum occupancy'); if (occ < 1 || occ > 20) throw new Error('Maximum occupancy must be between 1 and 20.');
  var dupe = Db.findBy('room_types', function (t) { return t.name.toLowerCase() === name.toLowerCase() && t.id !== Number(a.id || 0); });
  if (dupe) throw new Error('A room type with that name already exists.');
  var data = { name: name, base_rate: rate, max_occupancy: occ, description: str_(a.description), is_active: a.is_active === 0 || a.is_active === false ? 0 : 1 };
  var row = a.id ? Db.update('room_types', a.id, data) : Db.insert('room_types', data);
  audit_(ctx.user, a.id ? 'room_type_updated' : 'room_type_created', 'rooms', 'room_types', row.id);
  return clean_(row);
}

function roomSave_(ctx, a) {
  var num = need_(a.room_number, 'Room number');
  var type = Db.find('room_types', a.room_type_id); if (!type) throw new Error('Choose a valid room type.');
  var dupe = Db.findBy('rooms', function (r) { return r.room_number.toLowerCase() === num.toLowerCase() && r.id !== Number(a.id || 0); });
  if (dupe) throw new Error('Room ' + num + ' already exists.');
  var data = { room_type_id: type.id, room_number: num, building: str_(a.building), floor: str_(a.floor), notes: str_(a.notes),
    is_active: a.is_active === 0 || a.is_active === false ? 0 : 1 };
  var row;
  if (a.id) {
    var existing = Db.find('rooms', a.id); if (!existing) throw new Error('Room not found.');
    if (!data.is_active && Db.findBy('stays', { room_id: existing.id, status: 'active' })) throw new Error('A guest is checked into this room. Check them out before deactivating it.');
    row = Db.update('rooms', a.id, data);
  } else { data.status = 'available'; row = Db.insert('rooms', data); }
  audit_(ctx.user, a.id ? 'room_updated' : 'room_created', 'rooms', 'rooms', row.id);
  return clean_(row);
}

/** Throws if the room cannot be booked for the dates. excludeRrId lets a booking be moved against itself. */
function assertRoomAvailable_(roomId, arrival, departure, excludeRrId) {
  var resById = {}; Db.all('reservations').forEach(function (r) { resById[r.id] = r; });
  var clash = Db.findBy('reservation_rooms', function (rr) {
    if (rr.room_id !== roomId || rr.id === excludeRrId) return false;
    if (rr.status !== 'booked' && rr.status !== 'checked_in') return false;
    var r = resById[rr.reservation_id];
    return r && ['confirmed', 'pending', 'checked_in'].indexOf(r.status) !== -1 && r.arrival_date < departure && r.departure_date > arrival;
  });
  if (clash) throw new Error('Room is already booked for part of the requested date range.');
  var room = Db.find('rooms', roomId);
  if (!room || !room.is_active) throw new Error('Selected room does not exist or is inactive.');
  if (['maintenance', 'out_of_service', 'blocked'].indexOf(room.status) !== -1) throw new Error('Selected room is currently unavailable (maintenance/out of service/blocked).');
}

function assertOccupancy_(roomTypeId, adults, children) {
  if (adults < 1) throw new Error('At least 1 adult is required per room.');
  if (children < 0) throw new Error('Number of children cannot be negative.');
  var t = Db.find('room_types', roomTypeId); if (!t) throw new Error('Room type not found.');
  if (adults + children > t.max_occupancy) {
    throw new Error('"' + t.name + '" allows a maximum of ' + t.max_occupancy + ' guest' + (t.max_occupancy === 1 ? '' : 's') + ' (' + (adults + children) + ' requested).');
  }
}

function availableRooms_(a) {
  var arrival = str_(a.arrival), departure = str_(a.departure);
  if (!isDate_(arrival) || !isDate_(departure)) throw new Error('Enter valid arrival and departure dates.');
  if (departure <= arrival) throw new Error('Departure date must be after the arrival date.');
  return roomsList_().filter(function (r) {
    if (!r.is_active) return false;
    try { assertRoomAvailable_(r.id, arrival, departure); return true; } catch (e) { return false; }
  });
}

// ---------- guests ----------
function guestsList_(a) {
  var q = str_(a && a.q).toLowerCase();
  var rows = Db.all('guests').filter(function (g) {
    return !q || g.full_name.toLowerCase().indexOf(q) !== -1 || str_(g.phone).indexOf(q) !== -1 || g.guest_code.toLowerCase().indexOf(q) !== -1 || str_(g.id_number).toLowerCase().indexOf(q) !== -1;
  });
  rows.sort(function (x, y) { return y.id - x.id; });
  return cleanAll_(rows.slice(0, 200));
}

function guestSave_(ctx, a) {
  var name = need_(a.full_name, 'Full name');
  var gender = ['male', 'female', 'other', 'unspecified'].indexOf(a.gender) !== -1 ? a.gender : 'unspecified';
  var email = str_(a.email); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
  var data = { full_name: name, gender: gender, phone: str_(a.phone), email: email, address: str_(a.address), nationality: str_(a.nationality),
    id_type: str_(a.id_type), id_number: str_(a.id_number), company_name: str_(a.company_name), notes: str_(a.notes) };
  var row;
  if (a.id) { if (!Db.find('guests', a.id)) throw new Error('Guest not found.'); row = Db.update('guests', a.id, data); }
  else { data.guest_code = nextNumber_('guest'); row = Db.insert('guests', data); }
  audit_(ctx.user, a.id ? 'guest_updated' : 'guest_created', 'guests', 'guests', row.id);
  return clean_(row);
}

// ---------- reservations ----------
function reservationView_(r, guests, rrs, rooms) {
  var o = clean_(r); var g = guests[r.guest_id];
  o.guest_name = g ? g.full_name : ''; o.guest_phone = g ? g.phone : '';
  o.rooms = (rrs[r.id] || []).map(function (rr) { var c = clean_(rr); c.room_number = rooms[rr.room_id] ? rooms[rr.room_id].room_number : ''; return c; });
  o.nights = Math.max(1, dayNum_(r.departure_date) - dayNum_(r.arrival_date));
  return o;
}
function reservationIndexes_() {
  var guests = {}, rooms = {}, rrs = {};
  Db.all('guests').forEach(function (g) { guests[g.id] = g; });
  Db.all('rooms').forEach(function (r) { rooms[r.id] = r; });
  Db.all('reservation_rooms').forEach(function (rr) { (rrs[rr.reservation_id] = rrs[rr.reservation_id] || []).push(rr); });
  return { guests: guests, rooms: rooms, rrs: rrs };
}

function reservationsList_(a) {
  a = a || {}; var ix = reservationIndexes_(), q = str_(a.q).toLowerCase();
  var rows = Db.all('reservations').filter(function (r) {
    if (a.status && r.status !== a.status) return false;
    if (a.from && r.departure_date < a.from) return false;
    if (a.to && r.arrival_date > a.to) return false;
    if (q) { var g = ix.guests[r.guest_id]; if (r.reservation_number.toLowerCase().indexOf(q) === -1 && !(g && g.full_name.toLowerCase().indexOf(q) !== -1)) return false; }
    return true;
  });
  rows.sort(function (x, y) { return y.id - x.id; });
  return rows.slice(0, 300).map(function (r) { return reservationView_(r, ix.guests, ix.rrs, ix.rooms); });
}

function reservationCreate_(ctx, a) {
  var guest = Db.find('guests', a.guest_id); if (!guest) throw new Error('Choose a guest.');
  var arrival = str_(a.arrival_date), departure = str_(a.departure_date);
  if (!isDate_(arrival) || !isDate_(departure)) throw new Error('Enter valid arrival and departure dates.');
  if (departure <= arrival) throw new Error('Departure date must be after the arrival date.');
  var rooms = a.rooms || [];
  if (!rooms.length) throw new Error('At least one room must be selected.');
  var source = ['walk_in', 'phone', 'advance', 'agent', 'corporate', 'other'].indexOf(a.source) !== -1 ? a.source : 'walk_in';

  var seen = {}, prepared = [];
  rooms.forEach(function (r) {
    var roomId = Number(r.room_id); if (seen[roomId]) throw new Error('The same room was selected twice.'); seen[roomId] = true;
    var room = Db.find('rooms', roomId); if (!room) throw new Error('Selected room does not exist.');
    var type = Db.find('room_types', room.room_type_id);
    var adults = int_(r.adults === undefined || r.adults === '' ? 1 : r.adults, 'Adults'), children = int_(r.children === undefined || r.children === '' ? 0 : r.children, 'Children');
    assertRoomAvailable_(roomId, arrival, departure);
    assertOccupancy_(room.room_type_id, adults, children);
    var original = type.base_rate, rate = original;
    if (r.rate !== undefined && r.rate !== '' && r.rate !== null && money_(r.rate, 'Room rate') !== original) {
      requirePerm_(ctx, 'reservations.override_rate');
      rate = money_(r.rate, 'Room rate'); if (rate < 0) throw new Error('Room rate cannot be negative.');
      if (!str_(r.rate_override_reason)) throw new Error('A reason is required when changing the room rate.');
    }
    prepared.push({ room: room, adults: adults, children: children, rate: rate, original: original, reason: str_(r.rate_override_reason) });
  });

  var res = Db.insert('reservations', { reservation_number: nextNumber_('reservation'), guest_id: guest.id, source: source, arrival_date: arrival,
    departure_date: departure, status: 'confirmed', special_requests: str_(a.special_requests), notes: str_(a.notes), created_by: ctx.user.id });
  prepared.forEach(function (p) {
    var rr = Db.insert('reservation_rooms', { reservation_id: res.id, room_id: p.room.id, room_type_id: p.room.room_type_id, rate: p.rate,
      original_rate: p.original, adults: p.adults, children: p.children, status: 'booked' });
    if (p.rate !== p.original) Db.insert('rate_overrides', { reservation_room_id: rr.id, original_rate: p.original, new_rate: p.rate, reason: p.reason, approved_by: ctx.user.id });
    if (arrival === todayStr_() && p.room.status === 'available') Db.update('rooms', p.room.id, { status: 'reserved' });
  });
  audit_(ctx.user, 'reservation_created', 'reservations', 'reservations', res.id);
  return { id: res.id, reservation_number: res.reservation_number };
}

function releaseReservedRoom_(roomId) { var r = Db.find('rooms', roomId); if (r && r.status === 'reserved') Db.update('rooms', roomId, { status: 'available' }); }
function holdRoom_(roomId) { var r = Db.find('rooms', roomId); if (r && r.status === 'available') Db.update('rooms', roomId, { status: 'reserved' }); }

function reservationCancel_(ctx, a) {
  var res = Db.find('reservations', a.id); if (!res) throw new Error('Reservation not found.');
  if (['pending', 'confirmed'].indexOf(res.status) === -1) throw new Error('Only a booking that has not been checked in can be cancelled.');
  var reason = need_(a.reason, 'A cancellation reason');
  Db.where('reservation_rooms', { reservation_id: res.id }).forEach(function (rr) {
    Db.update('reservation_rooms', rr.id, { status: 'cancelled' });
    if (res.arrival_date === todayStr_()) releaseReservedRoom_(rr.room_id);
  });
  Db.update('reservations', res.id, { status: 'cancelled' });
  audit_(ctx.user, 'reservation_cancelled', 'reservations', 'reservations', res.id, res.status, 'cancelled', reason);
  return true;
}

function reservationChangeDates_(ctx, a) {
  var res = Db.find('reservations', a.id); if (!res) throw new Error('Reservation not found.');
  var arrival = str_(a.arrival_date), departure = str_(a.departure_date);
  if (!isDate_(arrival) || !isDate_(departure)) throw new Error('Enter valid dates.');
  if (departure <= arrival) throw new Error('Departure date must be after the arrival date.');
  if (['pending', 'confirmed'].indexOf(res.status) === -1) throw new Error('Only a booking that has not yet been checked in can have its dates changed.');
  var rrs = Db.where('reservation_rooms', { reservation_id: res.id, status: 'booked' });
  if (!rrs.length) throw new Error('This reservation has no active rooms to move.');
  rrs.forEach(function (rr) { assertRoomAvailable_(rr.room_id, arrival, departure, rr.id); });
  var today = todayStr_();
  Db.update('reservations', res.id, { arrival_date: arrival, departure_date: departure });
  rrs.forEach(function (rr) {
    if (res.arrival_date === today && arrival !== today) releaseReservedRoom_(rr.room_id);
    if (arrival === today && res.arrival_date !== today) holdRoom_(rr.room_id);
  });
  audit_(ctx.user, 'reservation_dates_changed', 'reservations', 'reservations', res.id, res.arrival_date + ' to ' + res.departure_date, arrival + ' to ' + departure);
  return true;
}

function reservationReassign_(ctx, a) {
  var rr = Db.find('reservation_rooms', a.reservation_room_id); if (!rr) throw new Error('Reservation room not found.');
  var res = Db.find('reservations', rr.reservation_id);
  if (rr.status !== 'booked' || ['confirmed', 'pending'].indexOf(res.status) === -1) throw new Error('Only a booking that has not yet been checked in can be reassigned to a different room.');
  var newId = Number(a.new_room_id); if (rr.room_id === newId) throw new Error('That is already the assigned room.');
  assertRoomAvailable_(newId, res.arrival_date, res.departure_date, rr.id);
  var room = Db.find('rooms', newId); if (!room) throw new Error('Selected room does not exist.');
  assertOccupancy_(room.room_type_id, rr.adults, rr.children);
  var old = rr.room_id;
  Db.update('reservation_rooms', rr.id, { room_id: newId, room_type_id: room.room_type_id });
  if (res.arrival_date === todayStr_()) { releaseReservedRoom_(old); holdRoom_(newId); }
  audit_(ctx.user, 'reservation_room_reassigned', 'reservations', 'reservation_rooms', rr.id, old, newId);
  return true;
}

// ---------- folio ----------
function folioTotals_(folioId) {
  var charges = 0, paid = 0;
  Db.where('folio_items', { folio_id: folioId }).forEach(function (i) { charges += i.amount; });
  Db.where('payments', { folio_id: folioId }).forEach(function (p) { paid += p.amount; });
  charges = round2_(charges); paid = round2_(paid);
  return { charges: charges, paid: paid, balance: round2_(charges - paid) };
}

function addCharge_(ctx, folioId, serviceCode, description, quantity, unitAmount) {
  var folio = Db.find('folios', folioId); if (!folio) throw new Error('Folio not found.');
  if (folio.status !== 'open') throw new Error('This folio is closed (the guest has checked out); new charges cannot be added to it.');
  unitAmount = money_(unitAmount, 'Charge amount');
  if (serviceCode === 'discount') { if (unitAmount >= 0) throw new Error('A discount must reduce the bill (be a negative amount).'); }
  else if (unitAmount < 0) throw new Error('A charge cannot be negative. To reduce a bill, apply a discount.');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantity must be a whole number of at least 1.');
  if (serviceCode === 'manual' && unitAmount <= 0) throw new Error('A manual charge needs an amount greater than zero.');
  if (!str_(description)) throw new Error('A description is required.');
  var amount = round2_(quantity * unitAmount);
  var item = Db.insert('folio_items', { folio_id: folioId, service_code: serviceCode, description: description, quantity: quantity, unit_amount: unitAmount, amount: amount, created_by: ctx.user.id });
  audit_(ctx.user, 'folio_charge_added', serviceCode, 'folio_items', item.id, null, amount);
  if (serviceCode === 'accommodation') {
    var h = hotel_();
    if (h && h.tax_enabled && h.tax_rate > 0) {
      var tax = round2_(amount * h.tax_rate / 100);
      if (tax > 0) {
        var label = (str_(h.tax_name) || 'Tax') + ' (' + String(h.tax_rate).replace(/\.0+$/, '') + '% on room charge)';
        var t = Db.insert('folio_items', { folio_id: folioId, service_code: 'tax', description: label, quantity: 1, unit_amount: tax, amount: tax, reference_type: 'tax_on', reference_id: item.id, created_by: ctx.user.id });
        audit_(ctx.user, 'folio_charge_added', 'tax', 'folio_items', t.id, null, tax);
      }
    }
  }
  return item.id;
}

function folioView_(a) {
  var folio = a.folio_id ? Db.find('folios', a.folio_id) : Db.findBy('folios', { stay_id: Number(a.stay_id) });
  if (!folio) throw new Error('Folio not found.');
  var stay = Db.find('stays', folio.stay_id), guest = Db.find('guests', stay.guest_id), room = Db.find('rooms', stay.room_id);
  var methods = {}; Db.all('payment_methods').forEach(function (m) { methods[m.id] = m.name; });
  var users = {}; Db.all('users').forEach(function (u) { users[u.id] = u.full_name; });
  var items = Db.where('folio_items', { folio_id: folio.id }).map(clean_);
  var pays = Db.where('payments', { folio_id: folio.id }).map(function (p) { var c = clean_(p); c.method_name = methods[p.payment_method_id] || ''; c.received_by_name = users[p.received_by] || ''; return c; });
  var res = Db.find('reservation_rooms', stay.reservation_room_id);
  var reservation = res ? Db.find('reservations', res.reservation_id) : null;
  var totals = folioTotals_(folio.id);
  return { folio: clean_(folio), stay: clean_(stay), guest: clean_(guest), room: room ? room.room_number : '', departure_date: reservation ? reservation.departure_date : '',
    items: items, payments: pays, charges: totals.charges, paid: totals.paid, balance: totals.balance, hotel: clean_(hotel_()),
    nights_due: stay.status === 'active' ? Math.max(0, nightsElapsed_(stay.checkin_at) - postedNights_(folio.id)) : 0 };
}

function postedNights_(folioId) { var n = 0; Db.where('folio_items', { folio_id: folioId, service_code: 'accommodation' }).forEach(function (i) { n += i.quantity; }); return n; }

// ---------- payments ----------
function paymentReceive_(ctx, a) {
  var amount = positiveMoney_(a.amount, 'Payment amount');
  var folio = Db.find('folios', a.folio_id); if (!folio) throw new Error('Folio not found.');
  var method = Db.find('payment_methods', a.payment_method_id); if (!method || !method.is_active) throw new Error('Choose a valid payment method.');
  var key = str_(a.idempotency_key);
  if (key) { var dup = Db.findBy('payments', function (p) { return p.idempotency_key === key; }); if (dup) return { id: dup.id, receipt_number: dup.receipt_number, duplicate: true }; }
  return receiveInternal_(ctx, folio.id, amount, method.id, str_(a.notes), key);
}
function receiveInternal_(ctx, folioId, amount, methodId, notes, key) {
  var p = Db.insert('payments', { folio_id: folioId, payment_number: nextNumber_('payment'), receipt_number: nextNumber_('receipt'), payment_method_id: methodId,
    amount: amount, status: 'completed', notes: notes, received_by: ctx.user.id, received_at: nowStr_(), idempotency_key: key || '' });
  audit_(ctx.user, 'payment_received', 'payments', 'payments', p.id, null, amount);
  return { id: p.id, receipt_number: p.receipt_number };
}

function paymentReverse_(ctx, a) {
  var amount = positiveMoney_(a.amount, 'Reversal amount');
  var reason = need_(a.reason, 'A reason');
  var orig = Db.find('payments', a.payment_id); if (!orig) throw new Error('Payment not found.');
  if (orig.amount <= 0) throw new Error('Only a positive (non-reversal) payment can be reversed.');
  if (orig.status === 'reversed') throw new Error('This payment has already been fully reversed.');
  var already = 0; Db.where('payments', { reversed_payment_id: orig.id }).forEach(function (p) { already += -p.amount; });
  var remaining = round2_(orig.amount - already);
  if (amount > remaining + 0.009) throw new Error('Reversal amount cannot exceed the remaining reversible amount (' + remaining.toFixed(2) + ').');
  var rev = Db.insert('payments', { folio_id: orig.folio_id, payment_number: nextNumber_('payment'), receipt_number: nextNumber_('receipt'), payment_method_id: orig.payment_method_id,
    amount: -amount, status: 'completed', reversed_payment_id: orig.id, notes: reason, received_by: ctx.user.id, received_at: nowStr_() });
  if (amount >= remaining - 0.009) Db.update('payments', orig.id, { status: 'reversed' });
  audit_(ctx.user, 'payment_reversed', 'payments', 'payments', rev.id, orig.amount, -amount, reason);
  return { id: rev.id, receipt_number: rev.receipt_number };
}

// ---------- front desk ----------
function checkIn_(ctx, a) {
  var rr = Db.find('reservation_rooms', a.reservation_room_id); if (!rr) throw new Error('Reservation room not found.');
  var res = Db.find('reservations', rr.reservation_id), room = Db.find('rooms', rr.room_id);
  if (rr.status !== 'booked') throw new Error('This booking has already been checked in, checked out, or cancelled.');
  if (['confirmed', 'pending'].indexOf(res.status) === -1) throw new Error('Reservation is not in a checkable-in state.');
  if (!room.is_active) throw new Error('Room is inactive and cannot be assigned.');
  if (Db.findBy('stays', { room_id: room.id, status: 'active' })) throw new Error('This room already has another guest checked in. Check that guest out before checking in a new one.');
  var override = !!a.override_unavailable;
  if (['maintenance', 'out_of_service', 'blocked', 'occupied', 'dirty', 'cleaning'].indexOf(room.status) !== -1) {
    if (!override) throw new Error("Room is currently '" + room.status + "' and cannot be assigned without an authorized override.");
    requirePerm_(ctx, 'frontdesk.override_unavailable');
  }
  var deposit = 0, methodId = null;
  if (a.deposit_amount !== undefined && a.deposit_amount !== '' && Number(a.deposit_amount) > 0) {
    requirePerm_(ctx, 'payments.receive');
    deposit = positiveMoney_(a.deposit_amount, 'Deposit');
    var m = Db.find('payment_methods', a.deposit_method_id); if (!m || !m.is_active) throw new Error('A payment method is required to record a deposit.');
    methodId = m.id;
  }
  var stay = Db.insert('stays', { reservation_room_id: rr.id, room_id: room.id, guest_id: res.guest_id, stay_number: nextNumber_('stay'), rate: rr.rate,
    checkin_at: nowStr_(), checked_in_by: ctx.user.id, status: 'active' });
  var folio = Db.insert('folios', { stay_id: stay.id, folio_number: nextNumber_('folio'), status: 'open', opened_at: nowStr_() });
  Db.update('reservation_rooms', rr.id, { status: 'checked_in' });
  Db.update('reservations', res.id, { status: 'checked_in' });
  Db.update('rooms', room.id, { status: 'occupied' });
  if (deposit > 0) receiveInternal_(ctx, folio.id, deposit, methodId, 'Deposit at check-in', '');
  audit_(ctx.user, 'checkin', 'front_desk', 'stays', stay.id, null, null, override ? 'Checked in with unavailable-room override' : '');
  return { stay_id: stay.id, folio_id: folio.id };
}

function checkoutPreview_(a) {
  var stay = Db.find('stays', a.stay_id); if (!stay) throw new Error('Stay not found.');
  var folio = Db.findBy('folios', { stay_id: stay.id });
  var due = Math.max(0, nightsElapsed_(stay.checkin_at) - postedNights_(folio.id));
  var t = folioTotals_(folio.id);
  var projected = round2_(t.balance + due * stay.rate * (1 + taxFactor_()));
  return { stay_id: stay.id, nights_due: due, rate: stay.rate, current_balance: t.balance, projected_balance: projected };
}
function taxFactor_() { var h = hotel_(); return h && h.tax_enabled && h.tax_rate > 0 ? h.tax_rate / 100 : 0; }

function checkOut_(ctx, a) {
  var stay = Db.find('stays', a.stay_id); if (!stay) throw new Error('Stay not found.');
  if (stay.status !== 'active') throw new Error('This stay has already been checked out.');
  var folio = Db.findBy('folios', { stay_id: stay.id }); if (!folio) throw new Error('Guest folio not found for this stay.');
  var pending = Db.where('restaurant_orders', function (o) { return o.folio_id === folio.id && ['settled', 'cancelled'].indexOf(o.status) === -1 && Db.where('restaurant_order_items', { order_id: o.id }).length > 0; });
  if (pending.length) throw new Error('This guest still has unsettled restaurant order(s): ' + pending.map(function (o) { return o.order_number; }).join(', ') + '. Settle (charge to room) or cancel each one, then check out again.');
  var due = nightsElapsed_(stay.checkin_at) - postedNights_(folio.id);

  // Work out the final balance BEFORE writing anything, so a refusal leaves no half-done checkout.
  var tax = taxFactor_();
  var projected = round2_(folioTotals_(folio.id).balance + (due > 0 ? round2_(due * stay.rate) + (tax > 0 ? round2_(round2_(due * stay.rate) * tax) : 0) : 0));
  if (projected > 0.009) {
    if (!a.allow_balance) throw new Error('Guest has an outstanding balance of ' + projected.toFixed(2) + '. An authorized user must approve checkout with a balance.');
    requirePerm_(ctx, 'payments.checkout_with_balance');
  }
  var creditNote = '';
  if (projected < -0.009) {
    creditNote = str_(a.credit_note);
    if (!a.credit_ack || !creditNote) throw new Error('The guest is owed ' + (-projected).toFixed(2) + '. Tick the confirmation and record how the credit was handled (refund, carried forward...) to check out.');
  }

  Db.where('restaurant_orders', function (o) { return o.folio_id === folio.id && ['settled', 'cancelled'].indexOf(o.status) === -1; }).forEach(function (o) { Db.update('restaurant_orders', o.id, { status: 'cancelled' }); });   // empty leftovers
  if (due > 0) addCharge_(ctx, folio.id, 'accommodation', 'Room accommodation (' + due + ' night' + (due === 1 ? '' : 's') + ')', due, stay.rate);
  var balance = folioTotals_(folio.id).balance;
  Db.update('stays', stay.id, { status: 'closed', checkout_at: nowStr_(), checked_out_by: ctx.user.id });
  Db.update('folios', folio.id, { status: 'closed', closed_at: nowStr_() });
  Db.update('reservation_rooms', stay.reservation_room_id, { status: 'checked_out' });
  Db.update('rooms', stay.room_id, { status: 'dirty' });
  var rr = Db.find('reservation_rooms', stay.reservation_room_id);
  var left = Db.where('reservation_rooms', function (x) { return x.reservation_id === rr.reservation_id && x.status !== 'checked_out' && x.status !== 'cancelled'; });
  if (!left.length) Db.update('reservations', rr.reservation_id, { status: 'checked_out' });
  audit_(ctx.user, 'checkout', 'front_desk', 'stays', stay.id, null, balance, balance > 0 ? 'Checked out with outstanding balance (approved)' : '');
  if (balance < -0.009) audit_(ctx.user, 'checkout_credit_balance', 'frontdesk', 'stays', stay.id, null, balance, creditNote);
  return { balance: balance };
}

function nightAudit_(ctx) {
  var posted = 0;
  Db.where('stays', { status: 'active' }).forEach(function (stay) {
    var folio = Db.findBy('folios', { stay_id: stay.id, status: 'open' }); if (!folio) return;
    var due = nightsElapsed_(stay.checkin_at) - postedNights_(folio.id);
    if (due > 0) { addCharge_(ctx, folio.id, 'accommodation', 'Room accommodation (' + due + ' night' + (due === 1 ? '' : 's') + ')', due, stay.rate); posted++; }
  });
  audit_(ctx.user, 'night_audit', 'front_desk', 'stays', '', null, posted);
  return { stays_updated: posted };
}

function inHouse_() {
  var guests = {}, rooms = {}, rrs = {}, ress = {};
  Db.all('guests').forEach(function (g) { guests[g.id] = g; }); Db.all('rooms').forEach(function (r) { rooms[r.id] = r; });
  Db.all('reservation_rooms').forEach(function (r) { rrs[r.id] = r; }); Db.all('reservations').forEach(function (r) { ress[r.id] = r; });
  var folios = {}; Db.all('folios').forEach(function (f) { folios[f.stay_id] = f; });
  return Db.where('stays', { status: 'active' }).map(function (s) {
    var o = clean_(s), rr = rrs[s.reservation_room_id], res = rr ? ress[rr.reservation_id] : null, f = folios[s.id];
    o.guest_name = guests[s.guest_id] ? guests[s.guest_id].full_name : ''; o.room_number = rooms[s.room_id] ? rooms[s.room_id].room_number : '';
    o.departure_date = res ? res.departure_date : ''; o.folio_id = f ? f.id : null; o.balance = f ? folioTotals_(f.id).balance : 0;
    return o;
  }).sort(function (a, b) { return a.room_number.localeCompare(b.room_number, undefined, { numeric: true }); });
}

function arrivals_() {
  var ix = reservationIndexes_(), today = todayStr_(), out = [];
  Db.all('reservations').forEach(function (r) {
    if (['confirmed', 'pending'].indexOf(r.status) === -1 || r.arrival_date > today || r.departure_date <= today) return;
    out.push(reservationView_(r, ix.guests, ix.rrs, ix.rooms));
  });
  return out.sort(function (a, b) { return a.arrival_date < b.arrival_date ? -1 : 1; });
}

// ---------- housekeeping ----------
function housekeepingBoard_() { return roomsList_().filter(function (r) { return r.is_active; }); }
function setRoomStatus_(ctx, a) {
  var room = Db.find('rooms', a.room_id); if (!room) throw new Error('Room not found.');
  var allowed = ['available', 'dirty', 'cleaning', 'clean', 'inspected', 'maintenance', 'out_of_service', 'blocked'];
  if (allowed.indexOf(a.status) === -1) throw new Error('That status cannot be set manually.');
  if (Db.findBy('stays', { room_id: room.id, status: 'active' })) throw new Error('A guest is checked into this room; its status changes at check-out.');
  var old = room.status; Db.update('rooms', room.id, { status: a.status });
  audit_(ctx.user, 'room_status_changed', 'housekeeping', 'rooms', room.id, old, a.status, str_(a.reason));
  return true;
}

// ---------- dashboard & reports ----------
function dashboard_() {
  var rooms = roomsList_().filter(function (r) { return r.is_active; }), counts = {};
  rooms.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
  var today = todayStr_(), received = 0;
  Db.all('payments').forEach(function (p) { if (String(p.received_at).substr(0, 10) === today) received += p.amount; });
  var inhouse = Db.where('stays', { status: 'active' }).length;
  var depart = inHouse_().filter(function (s) { return s.departure_date <= today; }).length;
  return { total_rooms: rooms.length, status_counts: counts, in_house: inhouse, occupancy_pct: rooms.length ? Math.round(inhouse * 1000 / rooms.length) / 10 : 0,
    arrivals_today: arrivals_().length, departures_due: depart, payments_today: round2_(received), currency: hotel_().currency_symbol, hotel_name: hotel_().name };
}

function report_(a) {
  var from = str_(a.from), to = str_(a.to);
  if (!isDate_(from) || !isDate_(to) || to < from) throw new Error('Choose a valid date range.');
  var inRange = function (ts) { var d = String(ts).substr(0, 10); return d >= from && d <= to; };
  var methods = {}; Db.all('payment_methods').forEach(function (m) { methods[m.id] = m.name; });
  var byMethod = {}, total = 0;
  Db.all('payments').forEach(function (p) { if (inRange(p.received_at)) { var n = methods[p.payment_method_id] || '?'; byMethod[n] = round2_((byMethod[n] || 0) + p.amount); total += p.amount; } });
  var byService = {}, charged = 0;
  Db.all('folio_items').forEach(function (i) { if (inRange(i.created_at)) { byService[i.service_code] = round2_((byService[i.service_code] || 0) + i.amount); charged += i.amount; } });
  var rooms = {}; Db.all('rooms').forEach(function (r) { rooms[r.id] = r; });
  var counts = {}; Db.all('stays').forEach(function (s) { if (inRange(s.checkin_at)) counts[s.room_id] = (counts[s.room_id] || 0) + 1; });
  var ci = Db.all('rooms').filter(function (r) { return r.is_active || counts[r.id]; }).map(function (r) { return { room_number: r.room_number, checkins: counts[r.id] || 0 }; })
    .sort(function (x, y) { return x.room_number.localeCompare(y.room_number, undefined, { numeric: true }); });
  var walkin = 0; Db.all('restaurant_orders').forEach(function (o) { if (o.status === 'settled' && o.settlement_type === 'walk_in' && inRange(o.settled_at)) walkin += o.amount_paid || 0; });
  var nights = 0, roomRev = 0; Db.all('folio_items').forEach(function (i) { if (i.service_code === 'accommodation' && inRange(i.created_at)) { nights += i.quantity; roomRev += i.amount; } });
  return { from: from, to: to, restaurant_walkin_sales: round2_(walkin), room_nights: nights, room_revenue: round2_(roomRev), average_rate: nights ? round2_(roomRev / nights) : 0, payments_by_method: byMethod, payments_total: round2_(total), charges_by_service: byService, charges_total: round2_(charged),
    checkins_per_room: ci, checkins_total: ci.reduce(function (s, r) { return s + r.checkins; }, 0) };
}

// ---------- users, roles, settings ----------
function usersList_() {
  var roles = {}; Db.all('roles').forEach(function (r) { roles[r.id] = r.name; });
  return Db.all('users').map(function (u) { var c = clean_(u); c.role = roles[u.role_id] || ''; return c; });
}
function userSave_(ctx, a) {
  var username = need_(a.username, 'Username');
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw new Error('Username must be 3-40 letters, numbers, dots, dashes or underscores.');
  var role = Db.find('roles', a.role_id); if (!role) throw new Error('Choose a role.');
  var dupe = Db.findBy('users', function (u) { return u.username.toLowerCase() === username.toLowerCase() && u.id !== Number(a.id || 0); });
  if (dupe) throw new Error('That username is already taken.');
  var active = a.is_active === 0 || a.is_active === false ? 0 : 1;
  var data = { role_id: role.id, username: username, full_name: need_(a.full_name, 'Full name'), phone: str_(a.phone), is_active: active };
  var row;
  if (a.id) {
    var u = Db.find('users', a.id); if (!u) throw new Error('User not found.');
    if (u.id === ctx.user.id && (!active || role.id !== u.role_id)) throw new Error('You cannot disable your own account or change your own role.');
    row = Db.update('users', u.id, data);
    if (!active) Db.where('sessions', { user_id: u.id }).slice().reverse().forEach(function (s) { Db.remove('sessions', s.id); });
  } else {
    validatePassword_(a.password); var salt = newSalt_();
    data.salt = salt; data.password_hash = hashPassword_(a.password, salt); data.failed_login_attempts = 0;
    row = Db.insert('users', data);
  }
  audit_(ctx.user, a.id ? 'user_updated' : 'user_created', 'users', 'users', row.id);
  return clean_(row);
}
function userResetPassword_(ctx, a) {
  var u = Db.find('users', a.id); if (!u) throw new Error('User not found.');
  validatePassword_(a.password); var salt = newSalt_();
  Db.update('users', u.id, { salt: salt, password_hash: hashPassword_(a.password, salt), failed_login_attempts: 0, locked_until: '' });
  Db.where('sessions', { user_id: u.id }).slice().reverse().forEach(function (s) { Db.remove('sessions', s.id); });
  audit_(ctx.user, 'password_reset', 'users', 'users', u.id);
  return true;
}
function changeOwnPassword_(ctx, a) {
  if (!constEq_(hashPassword_(String(a.current_password || ''), ctx.user.salt), ctx.user.password_hash)) throw new Error('Current password is incorrect.');
  validatePassword_(a.new_password); var salt = newSalt_();
  Db.update('users', ctx.user.id, { salt: salt, password_hash: hashPassword_(a.new_password, salt) });
  Db.where('sessions', function (s) { return s.user_id === ctx.user.id && s.id !== ctx.sessionId; }).slice().reverse().forEach(function (s) { Db.remove('sessions', s.id); });
  audit_(ctx.user, 'password_changed', 'security', 'users', ctx.user.id);
  return true;
}
function rolesList_() {
  return Db.all('roles').map(function (r) { var c = clean_(r); c.permissions = Db.where('role_permissions', { role_id: r.id }).map(function (p) { return p.permission_code; }); return c; });
}
function roleSave_(ctx, a) {
  var name = need_(a.name, 'Role name');
  var valid = PERMISSIONS.map(function (p) { return p[0]; });
  var perms = (a.permissions || []).filter(function (c) { return valid.indexOf(c) !== -1; });
  var dupe = Db.findBy('roles', function (r) { return r.name.toLowerCase() === name.toLowerCase() && r.id !== Number(a.id || 0); });
  if (dupe) throw new Error('A role with that name already exists.');
  var role;
  if (a.id) {
    role = Db.find('roles', a.id); if (!role) throw new Error('Role not found.');
    if (role.is_system) throw new Error('The Super Administrator role cannot be changed.');
    Db.update('roles', role.id, { name: name });
    Db.where('role_permissions', { role_id: role.id }).slice().reverse().forEach(function (rp) { Db.remove('role_permissions', rp.id); });
  } else role = Db.insert('roles', { name: name, is_system: 0 });
  perms.forEach(function (c) { Db.insert('role_permissions', { role_id: role.id, permission_code: c }); });
  audit_(ctx.user, 'role_saved', 'users', 'roles', role.id);
  return true;
}
function hotelSave_(ctx, a) {
  var h = hotel_(), rate = Number(a.tax_rate || 0);
  if (!isFinite(rate) || rate < 0 || rate > 100) throw new Error('Tax rate must be between 0 and 100.');
  Db.update('hotels', h.id, { name: need_(a.name, 'Hotel name'), address: str_(a.address), phone: str_(a.phone), email: str_(a.email),
    currency_symbol: str_(a.currency_symbol) || 'GH₵', tax_enabled: a.tax_enabled ? 1 : 0, tax_name: str_(a.tax_name) || 'Tax', tax_rate: rate });
  audit_(ctx.user, 'settings_changed', 'settings', 'hotels', h.id);
  return clean_(hotel_());
}
function auditList_(a) {
  var users = {}; Db.all('users').forEach(function (u) { users[u.id] = u.username; });
  var rows = Db.all('audit_logs').slice(-Math.min(Number((a && a.limit) || 200), 500)).reverse();
  return rows.map(function (r) { var c = clean_(r); c.username = users[r.user_id] || ''; return c; });
}

function monthlyReport_(a) {
  var m = str_(a.month);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new Error('Choose a valid month.');
  function range(ym) {
    var y = Number(ym.substr(0, 4)), mo = Number(ym.substr(5, 2)), last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { from: ym + '-01', to: ym + '-' + (last < 10 ? '0' : '') + last };
  }
  var y = Number(m.substr(0, 4)), mo = Number(m.substr(5, 2)), py = mo === 1 ? y - 1 : y, pm = mo === 1 ? 12 : mo - 1;
  var prev = py + '-' + (pm < 10 ? '0' : '') + pm, c = range(m), p = range(prev);
  return { month: m, previous_month: prev, current: report_(c), previous: report_(p), generated_at: nowStr_(), hotel: clean_(hotel_()) };
}
