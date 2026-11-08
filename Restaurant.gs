/** Restaurant.gs - tables, menu, orders, settlement (walk-in or room charge) and the receipt data. */

function rName_(table, id) { var r = id ? Db.find(table, id) : null; return r ? r.name : ''; }

function orderTotal_(orderId) { var t = 0; Db.where('restaurant_order_items', { order_id: orderId }).forEach(function (i) { t += i.amount; }); return round2_(t); }

function orderView_(o, withItems) {
  var c = clean_(o);
  c.table_name = rName_('restaurant_tables', o.table_id);
  var g = o.guest_id ? Db.find('guests', o.guest_id) : null; c.guest_name = g ? g.full_name : '';
  if (o.folio_id) { var f = Db.find('folios', o.folio_id), st = f ? Db.find('stays', f.stay_id) : null, rm = st ? Db.find('rooms', st.room_id) : null; c.room_number = rm ? rm.room_number : ''; }
  c.total = orderTotal_(o.id);
  if (withItems) c.items = Db.where('restaurant_order_items', { order_id: o.id }).map(clean_);
  return c;
}

function restaurantMenu_() {
  var cats = {}; Db.all('restaurant_categories').forEach(function (c) { cats[c.id] = c.name; });
  return { tables: cleanAll_(Db.all('restaurant_tables')), categories: cleanAll_(Db.all('restaurant_categories')),
    items: Db.all('restaurant_menu_items').map(function (m) { var c = clean_(m); c.category = cats[m.category_id] || ''; return c; }) };
}
function restTableSave_(ctx, a) {
  var name = need_(a.name, 'Table name');
  if (Db.findBy('restaurant_tables', function (t) { return t.name.toLowerCase() === name.toLowerCase() && t.id !== Number(a.id || 0); })) throw new Error('That table already exists.');
  var d = { name: name, is_active: a.is_active === 0 || a.is_active === false ? 0 : 1 };
  return clean_(a.id ? Db.update('restaurant_tables', a.id, d) : Db.insert('restaurant_tables', d));
}
function restCategorySave_(ctx, a) {
  var name = need_(a.name, 'Category name');
  if (Db.findBy('restaurant_categories', function (t) { return t.name.toLowerCase() === name.toLowerCase() && t.id !== Number(a.id || 0); })) throw new Error('That category already exists.');
  return clean_(a.id ? Db.update('restaurant_categories', a.id, { name: name }) : Db.insert('restaurant_categories', { name: name }));
}
function restMenuSave_(ctx, a) {
  var name = need_(a.name, 'Item name'), price = money_(a.price, 'Price'); if (price <= 0) throw new Error('Price must be greater than zero.');
  var cat = a.category_id ? Number(a.category_id) : null; if (cat && !Db.find('restaurant_categories', cat)) throw new Error('Choose a valid category.');
  var d = { name: name, price: price, category_id: cat, is_active: a.is_active === 0 || a.is_active === false ? 0 : 1 };
  return clean_(a.id ? Db.update('restaurant_menu_items', a.id, d) : Db.insert('restaurant_menu_items', d));
}

function restOrderCreate_(ctx, a) {
  var type = a.settlement_type === 'room_charge' ? 'room_charge' : 'walk_in', folio = null, guestId = null;
  if (type === 'room_charge') {
    folio = Db.find('folios', a.folio_id);
    if (!folio || folio.status !== 'open') throw new Error('A room-charge order must be linked to an in-house guest.');
    guestId = Db.find('stays', folio.stay_id).guest_id;
  }
  var table = a.table_id ? Db.find('restaurant_tables', a.table_id) : null;
  if (a.table_id && !table) throw new Error('Table not found.');
  var o = Db.insert('restaurant_orders', { order_number: nextNumber_('restaurant_order'), table_id: table ? table.id : null, settlement_type: type,
    folio_id: folio ? folio.id : null, guest_id: guestId, status: 'open', notes: str_(a.notes), created_by: ctx.user.id });
  audit_(ctx.user, 'restaurant_order_created', 'restaurant', 'restaurant_orders', o.id);
  return orderView_(o, true);
}
function openOrder_(id) {
  var o = Db.find('restaurant_orders', id); if (!o) throw new Error('Order not found.');
  if (o.status !== 'open') throw new Error('This order has already been sent to the kitchen and can no longer be edited.');
  return o;
}
function restAddItem_(ctx, a) {
  var o = openOrder_(a.order_id), qty = int_(a.quantity === undefined || a.quantity === '' || a.quantity === null ? 1 : a.quantity, 'Quantity'); if (qty < 1 || qty > 999) throw new Error('Quantity must be between 1 and 999.');
  var desc, price, menuId = null;
  if (a.menu_item_id) {
    var m = Db.find('restaurant_menu_items', a.menu_item_id); if (!m || !m.is_active) throw new Error('That menu item is not available.');
    desc = m.name; price = m.price; menuId = m.id;
  } else { desc = need_(a.description, 'Description'); price = positiveMoney_(a.unit_price, 'Price'); }
  Db.insert('restaurant_order_items', { order_id: o.id, menu_item_id: menuId, description: desc, quantity: qty, unit_price: price, amount: round2_(qty * price) });
  return orderView_(o, true);
}
function restRemoveItem_(ctx, a) {
  var it = Db.find('restaurant_order_items', a.item_id); if (!it) throw new Error('Item not found.');
  var o = openOrder_(it.order_id); Db.remove('restaurant_order_items', it.id); return orderView_(o, true);
}
function restSend_(ctx, a) {
  var o = openOrder_(a.order_id);
  if (!Db.where('restaurant_order_items', { order_id: o.id }).length) throw new Error('Add at least one item before sending to the kitchen.');
  Db.update('restaurant_orders', o.id, { status: 'sent_to_kitchen' }); return orderView_(Db.find('restaurant_orders', o.id), true);
}
function restServed_(ctx, a) {
  var o = Db.find('restaurant_orders', a.order_id); if (!o) throw new Error('Order not found.');
  if (o.status !== 'sent_to_kitchen') throw new Error('Only an order that has been sent to the kitchen can be marked served.');
  Db.update('restaurant_orders', o.id, { status: 'served' }); return orderView_(Db.find('restaurant_orders', o.id), true);
}
function restCancel_(ctx, a) {
  var o = Db.find('restaurant_orders', a.order_id); if (!o) throw new Error('Order not found.');
  if (o.status === 'settled') throw new Error('A settled order cannot be cancelled.');
  if (o.status === 'cancelled') throw new Error('This order is already cancelled.');
  Db.update('restaurant_orders', o.id, { status: 'cancelled' });
  audit_(ctx.user, 'restaurant_order_cancelled', 'restaurant', 'restaurant_orders', o.id, o.status, 'cancelled', str_(a.reason));
  return orderView_(Db.find('restaurant_orders', o.id), true);
}
function restSettle_(ctx, a) {
  var o = Db.find('restaurant_orders', a.order_id); if (!o) throw new Error('Order not found.');
  if (['open', 'sent_to_kitchen', 'served'].indexOf(o.status) === -1) throw new Error('This order cannot be settled from its current status.');
  var total = orderTotal_(o.id); if (total <= 0) throw new Error('Cannot settle an order with no items.');
  if (o.settlement_type === 'walk_in') {
    var m = Db.find('payment_methods', a.payment_method_id); if (!m || !m.is_active) throw new Error('Select a payment method to pay now.');
    Db.update('restaurant_orders', o.id, { status: 'settled', payment_method_id: m.id, amount_paid: total, settled_at: nowStr_() });
  } else {
    var folio = Db.find('folios', o.folio_id);
    if (!folio || folio.status !== 'open') throw new Error('The guest\'s folio is closed; this order can no longer be charged to the room.');
    var itemId = addCharge_(ctx, folio.id, 'restaurant', 'Restaurant order ' + o.order_number, 1, total);
    Db.update('restaurant_orders', o.id, { status: 'settled', folio_item_id: itemId, amount_paid: total, settled_at: nowStr_() });
  }
  audit_(ctx.user, 'restaurant_order_settled', 'restaurant', 'restaurant_orders', o.id, null, total);
  return orderView_(Db.find('restaurant_orders', o.id), true);
}
function restOrders_(a) {
  var st = a && a.status;
  var rows = Db.all('restaurant_orders').filter(function (o) { return st === 'active' ? ['open', 'sent_to_kitchen', 'served'].indexOf(o.status) !== -1 : (!st || o.status === st); });
  rows.sort(function (x, y) { return y.id - x.id; });
  return rows.slice(0, 200).map(function (o) { return orderView_(o, false); });
}

/** Receipt data. Restaurant sales print TWO copies (customer + restaurant); everything else prints one. */
function outletReceipt_(ctx, a) {
  var o = Db.find('restaurant_orders', a.order_id); if (!o) throw new Error('Order not found.');
  if (o.status !== 'settled') throw new Error('Only a settled order has a receipt.');
  var v = orderView_(o, true), m = o.payment_method_id ? Db.find('payment_methods', o.payment_method_id) : null, u = Db.find('users', o.created_by);
  v.method_name = m ? m.name : (o.settlement_type === 'room_charge' ? 'Charged to room ' + (v.room_number || '') : '');
  return { kind: 'restaurant', copies: ['CUSTOMER COPY', 'RESTAURANT COPY'], order: v, hotel: clean_(hotel_()), served_by: u ? u.full_name : '', printed_by: ctx.user.full_name, printed_at: nowStr_() };
}
function paymentReceipt_(ctx, a) {
  var p = Db.find('payments', a.payment_id); if (!p) throw new Error('Payment not found.');
  var folio = Db.find('folios', p.folio_id), st = Db.find('stays', folio.stay_id), g = Db.find('guests', st.guest_id), room = Db.find('rooms', st.room_id);
  var m = Db.find('payment_methods', p.payment_method_id), u = Db.find('users', p.received_by), tot = folioTotals_(folio.id);
  // A payment taken for a restaurant order prints the restaurant's two-copy layout; all other payments print one copy.
  var copies = /^Restaurant order/i.test(p.notes || '') ? ['CUSTOMER COPY', 'RESTAURANT COPY'] : [''];
  return { kind: 'payment', copies: copies, payment: clean_(p), method_name: m ? m.name : '', guest: clean_(g), room: room ? room.room_number : '', folio_number: folio.folio_number,
    balance: tot.balance, hotel: clean_(hotel_()), received_by: u ? u.full_name : '', printed_by: ctx.user.full_name, printed_at: nowStr_() };
}
