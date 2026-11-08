const { makeRuntime } = require('./gas-mock'); const assert = require('assert');
let pass = 0, fail = 0;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); } }
const rt = makeRuntime({ props: { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'Secret123', HOTEL_NAME: 'Test Hotel' } });
const run = n => rt.ctx[n]();
const ok = (r) => { assert.ok(r.ok, r.error); return r.data; };
const bad = (r, re) => { assert.ok(!r.ok, 'expected failure'); if (re) assert.ok(re.test(r.error), r.error); return r.error; };

run('setupDatabase'); run('addSampleRooms');
assert.strictEqual(rt.props.ADMIN_PASSWORD, undefined);
t('setup refuses to run twice', () => assert.throws(() => run('setupDatabase'), /Already set up|ADMIN/));

let T, FD, HK;
const today = () => rt.ctx.todayStr_();
const relog = () => { T = ok(rt.call('auth.login', null, { username: 'admin', password: 'Secret123' })).token; FD = ok(rt.call('auth.login', null, { username: 'fd1', password: PW.fd })).token; HK = ok(rt.call('auth.login', null, { username: 'hk1', password: 'Housekeep1' })).token; };
const PW = { fd: 'Frontdesk1' };
t('login rejects wrong password, generic message', () => { bad(rt.call('auth.login', null, { username: 'admin', password: 'nope' }), /Invalid username or password/); bad(rt.call('auth.login', null, { username: 'ghost', password: 'x' }), /Invalid username or password/); });
t('login works; token required for everything else', () => {
  const d = ok(rt.call('auth.login', null, { username: 'ADMIN', password: 'Secret123' })); T = d.token;
  assert.ok(T.length >= 60); assert.ok(d.user.permissions.length > 20);
  bad(rt.call('rooms.list', null, {}), /session/); bad(rt.call('rooms.list', 'forged', {}), /session/);
});
t('lockout after 5 failures', () => {
  for (let i = 0; i < 5; i++) rt.call('auth.login', null, { username: 'admin', password: 'bad' });
  bad(rt.call('auth.login', null, { username: 'admin', password: 'Secret123' }), /Too many/);
  rt.advanceDays(1); ok(rt.call('auth.login', null, { username: 'admin', password: 'Secret123' }));
});

t('sessions expire', () => { rt.advanceDays(1); bad(rt.call('rooms.list', T, {}), /session/); T = ok(rt.call('auth.login', null, { username: 'admin', password: 'Secret123' })).token; });

t('roles/users: create front desk + housekeeping users', () => {
  const roles = ok(rt.call('roles.list', T, {})); const fd = roles.find(r => r.name === 'Front Desk'), hk = roles.find(r => r.name === 'Housekeeping');
  bad(rt.call('users.save', T, { username: 'fd1', full_name: 'Ama', role_id: fd.id, password: 'short' }), /8 characters/);
  ok(rt.call('users.save', T, { username: 'fd1', full_name: 'Ama', role_id: fd.id, password: 'Frontdesk1' }));
  ok(rt.call('users.save', T, { username: 'hk1', full_name: 'Kofi', role_id: hk.id, password: 'Housekeep1' }));
  bad(rt.call('users.save', T, { username: 'FD1', full_name: 'Dup', role_id: fd.id, password: 'Frontdesk1' }), /taken/);
  FD = ok(rt.call('auth.login', null, { username: 'fd1', password: 'Frontdesk1' })).token;
  HK = ok(rt.call('auth.login', null, { username: 'hk1', password: 'Housekeep1' })).token;
});
t('permissions enforced', () => { bad(rt.call('users.list', FD, {}), /permission/); bad(rt.call('reports.get', HK, { from: addDays(today(), -30), to: addDays(today(), 30) }), /permission/); bad(rt.call('rooms.save', FD, { room_number: '9', room_type_id: 1 }), /permission/); ok(rt.call('rooms.list', HK, {})); });

let G, RES, rooms;
t('guest create/search/validation', () => {
  bad(rt.call('guests.save', FD, { full_name: '' }), /required/); bad(rt.call('guests.save', FD, { full_name: 'X', email: 'nope' }), /email/);
  G = ok(rt.call('guests.save', FD, { full_name: 'Kwame Mensah', phone: '0241234567' }));
  assert.strictEqual(G.guest_code, 'G-00001');
  assert.strictEqual(ok(rt.call('guests.list', FD, { q: '0241' })).length, 1);
});
t('reservation: dates, availability, occupancy, rate override', () => {
  rooms = ok(rt.call('rooms.list', FD, {}));
  const r101 = rooms.find(r => r.room_number === '101'), r201 = rooms.find(r => r.room_number === '201');
  bad(rt.call('reservations.create', FD, { guest_id: G.id, arrival_date: addDays(today(), 2), departure_date: addDays(today(), 1), rooms: [{ room_id: r101.id }] }), /after the arrival/);
  bad(rt.call('reservations.create', FD, { guest_id: G.id, arrival_date: today(), departure_date: addDays(today(), 2), rooms: [{ room_id: r101.id, adults: 3 }] }), /maximum of 2/);
  bad(rt.call('reservations.create', FD, { guest_id: G.id, arrival_date: today(), departure_date: addDays(today(), 2), rooms: [{ room_id: r101.id, rate: 100, rate_override_reason: 'x' }] }), /permission/);
  RES = ok(rt.call('reservations.create', FD, { guest_id: G.id, arrival_date: today(), departure_date: addDays(today(), 2), rooms: [{ room_id: r101.id, adults: 2 }] }));
  assert.strictEqual(RES.reservation_number, 'RES-00001');
  bad(rt.call('reservations.create', FD, { guest_id: G.id, arrival_date: addDays(today(), 1), departure_date: addDays(today(), 3), rooms: [{ room_id: r101.id }] }), /already booked/);
  assert.ok(!ok(rt.call('rooms.available', FD, { arrival: addDays(today(), 1), departure: addDays(today(), 3) })).some(r => r.room_number === '101'));
  assert.ok(ok(rt.call('rooms.available', FD, { arrival: addDays(today(), 2), departure: addDays(today(), 3) })).some(r => r.room_number === '101'));
  const ov = ok(rt.call('reservations.create', T, { guest_id: G.id, arrival_date: addDays(today(), 10), departure_date: addDays(today(), 11), rooms: [{ room_id: r201.id, rate: 300, rate_override_reason: 'corporate' }] }));
  assert.ok(ov.id);
  assert.strictEqual(rooms.find(r => r.id === r101.id).status, 'available');
  assert.strictEqual(ok(rt.call('rooms.list', FD, {})).find(r => r.id === r101.id).status, 'reserved');
});
let ST, FOL;
t('check-in creates stay+folio, blocks double check-in', () => {
  const rr = ok(rt.call('reservations.list', FD, {}))[1].rooms[0] || ok(rt.call('reservations.list', FD, {})).find(x => x.id === RES.id).rooms[0];
  const resv = ok(rt.call('reservations.list', FD, {})).find(x => x.id === RES.id); const rrId = resv.rooms[0].id;
  bad(rt.call('frontdesk.checkIn', HK, { reservation_room_id: rrId }), /permission/);
  bad(rt.call('frontdesk.checkIn', FD, { reservation_room_id: rrId, deposit_amount: 50, deposit_method_id: 99 }), /payment method/);
  assert.strictEqual(ok(rt.call('frontdesk.inHouse', FD, {})).length, 0, 'failed check-in must not leave a stay');
  const c = ok(rt.call('frontdesk.checkIn', FD, { reservation_room_id: rrId, deposit_amount: 100, deposit_method_id: 1 }));
  ST = c.stay_id; FOL = c.folio_id;
  bad(rt.call('frontdesk.checkIn', FD, { reservation_room_id: rrId }), /already been checked in/);
  const f = ok(rt.call('folio.get', FD, { stay_id: ST })); assert.strictEqual(f.paid, 100); assert.strictEqual(f.balance, -100); assert.strictEqual(f.room, '101');
});
t('folio rules: manual charge, discount, closed folio', () => {
  bad(rt.call('folio.addCharge', FD, { folio_id: FOL, description: 'Laundry', unit_amount: -5 }), /negative|greater than zero/);
  bad(rt.call('folio.addCharge', FD, { folio_id: FOL, description: 'Laundry', unit_amount: 0 }), /greater than zero/);
  bad(rt.call('folio.addCharge', FD, { folio_id: FOL, description: 'Laundry', quantity: 1.5, unit_amount: 5 }), /whole number/);
  ok(rt.call('folio.addCharge', FD, { folio_id: FOL, description: 'Laundry', quantity: 2, unit_amount: 15 }));
  bad(rt.call('folio.discount', FD, { folio_id: FOL, amount: 10 }), /permission/);
  ok(rt.call('folio.discount', T, { folio_id: FOL, amount: 10, description: 'Goodwill' }));
  assert.strictEqual(ok(rt.call('folio.get', FD, { stay_id: ST })).charges, 20);
});
t('payments: idempotency, validation, reversal limits', () => {
  bad(rt.call('payments.receive', FD, { folio_id: FOL, payment_method_id: 1, amount: 0 }), /greater than zero/);
  bad(rt.call('payments.receive', FD, { folio_id: FOL, payment_method_id: 1, amount: 'abc' }), /valid number/);
  const a = ok(rt.call('payments.receive', FD, { folio_id: FOL, payment_method_id: 2, amount: 40, idempotency_key: 'k1' }));
  const b = ok(rt.call('payments.receive', FD, { folio_id: FOL, payment_method_id: 2, amount: 40, idempotency_key: 'k1' }));
  assert.strictEqual(a.id, b.id); assert.ok(b.duplicate);
  bad(rt.call('payments.reverse', FD, { payment_id: a.id, amount: 10, reason: 'x' }), /permission/);
  bad(rt.call('payments.reverse', T, { payment_id: a.id, amount: 50, reason: 'x' }), /exceed/);
  bad(rt.call('payments.reverse', T, { payment_id: a.id, amount: 10, reason: '' }), /reason/);
  ok(rt.call('payments.reverse', T, { payment_id: a.id, amount: 10, reason: 'typo' }));
  ok(rt.call('payments.reverse', T, { payment_id: a.id, amount: 30, reason: 'rest' }));
  bad(rt.call('payments.reverse', T, { payment_id: a.id, amount: 1, reason: 'again' }), /already been fully reversed/);
  assert.strictEqual(ok(rt.call('folio.get', FD, { stay_id: ST })).paid, 100);
});
t('checkout: credit prompt, balance rule, nights, room goes dirty', () => {
  rt.advanceDays(2); relog();  // two nights
  const pv = ok(rt.call('frontdesk.checkoutPreview', FD, { stay_id: ST })); assert.strictEqual(pv.nights_due, 2); assert.strictEqual(pv.projected_balance, 2 * 250 + 20 - 100);
  bad(rt.call('frontdesk.checkOut', FD, { stay_id: ST }), /outstanding balance of 420/.source ? /outstanding balance/ : null);
  bad(rt.call('frontdesk.checkOut', FD, { stay_id: ST, allow_balance: true }), /permission/);
  assert.strictEqual(ok(rt.call('folio.get', FD, { stay_id: ST })).items.filter(i => i.service_code === 'accommodation').length, 0, 'refused checkout must not post charges');
  ok(rt.call('payments.receive', FD, { folio_id: FOL, payment_method_id: 1, amount: 600 }));
  bad(rt.call('frontdesk.checkOut', FD, { stay_id: ST }), /owed/);
  ok(rt.call('frontdesk.checkOut', FD, { stay_id: ST, credit_ack: true, credit_note: 'Refunded in cash' }));
  const f = ok(rt.call('folio.get', FD, { stay_id: ST })); assert.strictEqual(f.folio.status, 'closed'); assert.strictEqual(f.balance, -180);
  assert.strictEqual(ok(rt.call('rooms.list', FD, {})).find(r => r.room_number === '101').status, 'dirty');
  bad(rt.call('frontdesk.checkOut', FD, { stay_id: ST }), /already been checked out/);
  bad(rt.call('folio.addCharge', FD, { folio_id: FOL, description: 'late', unit_amount: 5 }), /closed/);
});
t('housekeeping flow', () => {
  const r = ok(rt.call('rooms.list', HK, {})).find(x => x.room_number === '101');
  ok(rt.call('housekeeping.setStatus', HK, { room_id: r.id, status: 'cleaning' })); ok(rt.call('housekeeping.setStatus', HK, { room_id: r.id, status: 'available' }));
  bad(rt.call('housekeeping.setStatus', HK, { room_id: r.id, status: 'occupied' }), /cannot be set/);
});
t('cancel + change dates + reassign', () => {
  const r102 = ok(rt.call('rooms.list', FD, {})).find(x => x.room_number === '102'), r103 = ok(rt.call('rooms.list', FD, {})).find(x => x.room_number === '103');
    const res = ok(rt.call('reservations.create', FD, { guest_id: G.id, arrival_date: addDays(today(), 20), departure_date: addDays(today(), 22), rooms: [{ room_id: r102.id }] }));
  const rrId = ok(rt.call('reservations.list', FD, {})).find(x => x.id === res.id).rooms[0].id;
  ok(rt.call('reservations.changeDates', FD, { id: res.id, arrival_date: addDays(today(), 21), departure_date: addDays(today(), 24) }));
  ok(rt.call('reservations.reassign', FD, { reservation_room_id: rrId, new_room_id: r103.id }));
  bad(rt.call('reservations.cancel', FD, { id: res.id, reason: '' }), /reason/);
  ok(rt.call('reservations.cancel', FD, { id: res.id, reason: 'guest called' }));
  assert.ok(ok(rt.call('rooms.available', FD, { arrival: addDays(today(), 21), departure: addDays(today(), 24) })).some(r => r.room_number === '103'));
  bad(rt.call('reservations.cancel', FD, { id: res.id, reason: 'again' }), /not been checked in/);
});
t('night audit posts nights once, with tax', () => {
  ok(rt.call('hotel.save', T, { name: 'Test Hotel', tax_enabled: true, tax_name: 'VAT', tax_rate: 15, currency_symbol: 'GH₵' }));
  const r104 = ok(rt.call('rooms.list', FD, {})).find(x => x.room_number === '104');
  const d = today(); const res = ok(rt.call('reservations.create', FD, { guest_id: G.id, arrival_date: d, departure_date: addDays(d, 4), rooms: [{ room_id: r104.id }] }));
  const rrId = ok(rt.call('reservations.list', FD, {})).find(x => x.id === res.id).rooms[0].id;
  const c = ok(rt.call('frontdesk.checkIn', FD, { reservation_room_id: rrId }));
  rt.advanceDays(1); relog(); assert.strictEqual(ok(rt.call('frontdesk.nightAudit', FD, {})).stays_updated, 1); assert.strictEqual(ok(rt.call('frontdesk.nightAudit', FD, {})).stays_updated, 0);
  const f = ok(rt.call('folio.get', FD, { stay_id: c.stay_id })); assert.strictEqual(f.charges, 250 + 37.5);
});
t('dashboard + reports', () => {
  const d = ok(rt.call('dashboard.get', FD, {})); assert.strictEqual(d.total_rooms, 6); assert.strictEqual(d.in_house, 1);
  const r = ok(rt.call('reports.get', FD, { from: addDays(today(), -30), to: addDays(today(), 30) })); assert.strictEqual(r.checkins_total, 2); assert.ok(r.payments_total > 0);
  bad(rt.call('reports.get', FD, { from: addDays(today(), 30), to: addDays(today(), -30) }), /date range/);
});
t('password change invalidates other sessions; disabled user is signed out at once', () => {
  const s2 = ok(rt.call('auth.login', null, { username: 'fd1', password: 'Frontdesk1' })).token;
  PW.fd = 'Newpass123'; ok(rt.call('auth.changePassword', FD, { current_password: 'Frontdesk1', new_password: 'Newpass123' }));
  bad(rt.call('rooms.list', s2, {}), /session/); ok(rt.call('rooms.list', FD, {}));
  const u = ok(rt.call('users.list', T, {})).find(x => x.username === 'fd1');
  ok(rt.call('users.save', T, { id: u.id, username: 'fd1', full_name: 'Ama', role_id: u.role_id, is_active: false }));
  bad(rt.call('rooms.list', FD, {}), /session/);
  const me = ok(rt.call('users.list', T, {})).find(x => x.username === 'admin');
  bad(rt.call('users.save', T, { id: me.id, username: 'admin', full_name: 'A', role_id: me.role_id, is_active: false }), /own account/);
});
t('data stays text: dates are not turned into Date objects; hashes never leak', () => {
  const d = ok(rt.call('reservations.list', T, {}))[0]; assert.strictEqual(typeof d.arrival_date, 'string');
  assert.ok(!JSON.stringify(ok(rt.call('users.list', T, {}))).includes('password_hash'));
});
t('unknown action / bad JSON do not crash', () => { bad(rt.call('nope', T, {})); assert.strictEqual(rt.ctx.rpc('not json').ok, false); });
t('audit trail records actions', () => { const a = ok(rt.call('audit.list', T, {})); ['checkin', 'checkout', 'payment_reversed', 'checkout_credit_balance', 'login'].forEach(x => assert.ok(a.some(r => r.action === x), x)); });

// ---------------- restaurant, receipts, monthly report ----------------
run('addSampleRestaurant');
T = ok(rt.call('auth.login', null, { username: 'admin', password: 'Secret123' })).token;
{ const fdRole = ok(rt.call('roles.list', T, {})).find(r => r.name === 'Front Desk'); ok(rt.call('users.save', T, { username: 'fd2', full_name: 'Esi', role_id: fdRole.id, password: 'Frontdesk2' }));
  FD = ok(rt.call('auth.login', null, { username: 'fd2', password: 'Frontdesk2' })).token; HK = ok(rt.call('auth.login', null, { username: 'hk1', password: 'Housekeep1' })).token; }
{ // a guest in house for the room-charge tests
  const g = ok(rt.call('guests.save', FD, { full_name: 'Yaw Owusu' })); const rm = ok(rt.call('rooms.list', FD, {})).find(r => r.room_number === '202');
  const res = ok(rt.call('reservations.create', FD, { guest_id: g.id, arrival_date: today(), departure_date: addDays(today(), 3), rooms: [{ room_id: rm.id }] }));
  const rrId = ok(rt.call('reservations.list', FD, {})).find(x => x.id === res.id).rooms[0].id; ok(rt.call('frontdesk.checkIn', FD, { reservation_room_id: rrId })); }
let M, WALK, ROOMORD, RF, RSTAY;
t('restaurant: menu validation and permissions', () => {
  M = ok(rt.call('restaurant.menu', T, {})); assert.strictEqual(M.items.length, 5); assert.strictEqual(M.tables.length, 4);
  bad(rt.call('restaurant.menuSave', FD, { name: 'X', price: 5 }), /permission/);
  bad(rt.call('restaurant.menuSave', T, { name: 'X', price: 0 }), /greater than zero/);
  bad(rt.call('restaurant.tableSave', T, { name: 'table 1' }), /already exists/);
  bad(rt.call('restaurant.menu', HK, {}), /permission/);
});
t('restaurant: walk-in order lifecycle', () => {
  const o = ok(rt.call('restaurant.create', FD, { settlement_type: 'walk_in', table_id: M.tables[0].id })); WALK = o.id;
  assert.strictEqual(o.order_number, 'RST-00001');
  bad(rt.call('restaurant.send', FD, { order_id: WALK }), /at least one item/);
  bad(rt.call('restaurant.addItem', FD, { order_id: WALK, menu_item_id: M.items[0].id, quantity: 0 }), /between 1 and 999/);
  ok(rt.call('restaurant.addItem', FD, { order_id: WALK, menu_item_id: M.items[0].id, quantity: 2 }));
  const o2 = ok(rt.call('restaurant.addItem', FD, { order_id: WALK, description: 'Special juice', unit_price: 12.5, quantity: 1 }));
  assert.strictEqual(o2.total, 142.5);
  bad(rt.call('restaurant.settle', FD, { order_id: WALK }), /payment method/);
  ok(rt.call('restaurant.send', FD, { order_id: WALK }));
  bad(rt.call('restaurant.addItem', FD, { order_id: WALK, menu_item_id: M.items[1].id }), /no longer be edited/);
  ok(rt.call('restaurant.served', FD, { order_id: WALK }));
  const s = ok(rt.call('restaurant.settle', FD, { order_id: WALK, payment_method_id: 1 })); assert.strictEqual(s.status, 'settled'); assert.strictEqual(s.amount_paid, 142.5);
  bad(rt.call('restaurant.settle', FD, { order_id: WALK, payment_method_id: 1 }), /cannot be settled/);
  bad(rt.call('restaurant.cancel', FD, { order_id: WALK }), /settled order cannot be cancelled/);
});
t('restaurant receipt: TWO copies; hotel payment receipt: ONE copy', () => {
  const r = ok(rt.call('receipt.outlet', FD, { order_id: WALK })); assert.deepStrictEqual(r.copies, ['CUSTOMER COPY', 'RESTAURANT COPY']); assert.strictEqual(r.order.items.length, 2);
  const open = ok(rt.call('restaurant.create', FD, { settlement_type: 'walk_in' })); bad(rt.call('receipt.outlet', FD, { order_id: open.id }), /settled/);
  const folio = ok(rt.call('folio.get', FD, { stay_id: ok(rt.call('frontdesk.inHouse', FD, {}))[0].id }));
  const pay = ok(rt.call('payments.receive', FD, { folio_id: folio.folio.id, payment_method_id: 1, amount: 10 }));
  const pr = ok(rt.call('receipt.payment', FD, { payment_id: pay.id })); assert.deepStrictEqual(pr.copies, ['']); assert.strictEqual(pr.kind, 'payment');
  const pay2 = ok(rt.call('payments.receive', FD, { folio_id: folio.folio.id, payment_method_id: 1, amount: 10, notes: 'Restaurant order RST-00009' }));
  assert.strictEqual(ok(rt.call('receipt.payment', FD, { payment_id: pay2.id })).copies.length, 2);
  bad(rt.call('receipt.payment', HK, { payment_id: pay.id }), /permission/);
});
t('restaurant: room charge posts to folio and blocks checkout until settled', () => {
  const inh = ok(rt.call('frontdesk.inHouse', FD, {}))[0]; RSTAY = inh.id; RF = inh.folio_id;
  bad(rt.call('restaurant.create', FD, { settlement_type: 'room_charge', folio_id: 9999 }), /in-house guest/);
  const o = ok(rt.call('restaurant.create', FD, { settlement_type: 'room_charge', folio_id: RF })); ROOMORD = o.id;
  ok(rt.call('restaurant.addItem', FD, { order_id: ROOMORD, menu_item_id: M.items[1].id, quantity: 2 }));
  bad(rt.call('frontdesk.checkOut', FD, { stay_id: RSTAY, allow_balance: true }), /unsettled restaurant/);
  const before = ok(rt.call('folio.get', FD, { stay_id: RSTAY })).charges;
  ok(rt.call('restaurant.send', FD, { order_id: ROOMORD })); const s = ok(rt.call('restaurant.settle', FD, { order_id: ROOMORD }));
  assert.strictEqual(ok(rt.call('folio.get', FD, { stay_id: RSTAY })).charges, before + 170);
  assert.ok(ok(rt.call('folio.get', FD, { stay_id: RSTAY })).items.some(i => i.service_code === 'restaurant' && /RST-/.test(i.description)));
  assert.strictEqual(ok(rt.call('receipt.outlet', FD, { order_id: ROOMORD })).copies.length, 2);
});
t('restaurant: empty leftover orders are cancelled at checkout; reports include sales', () => {
  const empty = ok(rt.call('restaurant.create', FD, { settlement_type: 'room_charge', folio_id: RF }));
  const r = ok(rt.call('reports.get', T, { from: addDays(today(), -5), to: addDays(today(), 5) })); assert.strictEqual(r.restaurant_walkin_sales, 142.5);
  assert.ok(r.charges_by_service.restaurant >= 170); assert.ok(r.room_nights >= 1);
  ok(rt.call('payments.receive', T, { folio_id: RF, payment_method_id: 1, amount: 100000 }));
  bad(rt.call('frontdesk.checkOut', T, { stay_id: RSTAY }), /owed/);
  ok(rt.call('frontdesk.checkOut', T, { stay_id: RSTAY, credit_ack: true, credit_note: 'refund' }));
  assert.strictEqual(ok(rt.call('restaurant.order', T, { order_id: empty.id })).status, 'cancelled');
});
t('monthly report: current vs previous month, check-ins per room', () => {
  const mth = today().slice(0, 7); const m = ok(rt.call('reports.monthly', FD, { month: mth }));
  assert.ok(m.current.checkins_per_room.length >= 6); assert.ok(m.current.checkins_total >= 1); assert.ok(m.previous_month < mth);
  assert.strictEqual(ok(rt.call('reports.monthly', FD, { month: '2026-01' })).previous_month, '2025-12');
  bad(rt.call('reports.monthly', FD, { month: '2026-13' }), /valid month/); bad(rt.call('reports.monthly', HK, { month: mth }), /permission/);
});
t('Super Administrator gets permissions added later; custom role cannot be given unknown ones', () => {
  const adm = rt.call('auth.me', T, {}).data; assert.ok(adm.permissions.includes('restaurant.manage'));
  const roles = ok(rt.call('roles.list', T, {}));
  ok(rt.call('roles.save', T, { name: 'Waiter', permissions: ['restaurant.view', 'restaurant.transact', 'bogus.perm'] }));
  assert.deepStrictEqual(ok(rt.call('roles.list', T, {})).find(r => r.name === 'Waiter').permissions.sort(), ['restaurant.transact', 'restaurant.view']);
});
t('editor password reset recovers a locked-out admin and erases the temp password', () => {
  for (let i = 0; i < 5; i++) rt.call('auth.login', null, { username: 'admin', password: 'bad' });
  bad(rt.call('auth.login', null, { username: 'admin', password: 'Secret123' }), /Too many/);
  assert.throws(() => rt.ctx.resetUserPassword(), /RESET_USERNAME/);
  rt.props.RESET_USERNAME = 'admin'; rt.props.RESET_PASSWORD = 'Brandnew99'; rt.ctx.resetUserPassword();
  assert.strictEqual(rt.props.RESET_PASSWORD, undefined);
  ok(rt.call('auth.login', null, { username: 'admin', password: 'Brandnew99' }));
  bad(rt.call('auth.login', null, { username: 'admin', password: 'Secret123' }), /Invalid/);
});
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
