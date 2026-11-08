/** Setup.gs - first-run: creates the sheets, the hotel, roles, default data and the admin user. */

/**
 * Run ONCE from the Apps Script editor (Run > setupDatabase) after setting the
 * script properties ADMIN_USERNAME / ADMIN_PASSWORD (see README). It never
 * overwrites an existing installation.
 */
function setupDatabase() {
  var props = PropertiesService.getScriptProperties();
  var adminUser = props.getProperty('ADMIN_USERNAME');
  var adminPass = props.getProperty('ADMIN_PASSWORD');
  if (!adminUser || !adminPass) throw new Error('Set script properties ADMIN_USERNAME and ADMIN_PASSWORD first (Project Settings > Script properties).');
  validatePassword_(adminPass);

  withLock_(function () {
    Db.ensureAll();
    if (Db.all('hotels').length) throw new Error('Already set up. Delete the sheets only if you really want to start over.');
    var hotelName = props.getProperty('HOTEL_NAME') || 'My Hotel';
    Db.insert('hotels', { name: hotelName, address: '', phone: '', email: '', currency_symbol: 'GH₵', tax_enabled: 0, tax_name: 'VAT', tax_rate: 0 });

    var codes = PERMISSIONS.map(function (p) { return p[0]; });
    function makeRole(name, perms, sys) {
      var r = Db.insert('roles', { name: name, is_system: sys ? 1 : 0 });
      perms.forEach(function (c) { Db.insert('role_permissions', { role_id: r.id, permission_code: c }); });
      return r;
    }
    var admin = makeRole('Super Administrator', codes, true);
    makeRole('Manager', codes.filter(function (c) { return c !== 'roles.manage'; }));
    makeRole('Front Desk', ['rooms.view','guests.view','guests.manage','reservations.view','reservations.create','reservations.edit',
      'frontdesk.view','frontdesk.checkin','frontdesk.checkout','housekeeping.view','folio.view','folio.add_charge','payments.receive','reports.view','invoicing.print','restaurant.view','restaurant.transact']);
    makeRole('Housekeeping', ['rooms.view','housekeeping.view','housekeeping.update']);

    ['Cash|cash', 'Mobile Money|momo', 'POS/Card|card', 'Bank Transfer|bank'].forEach(function (s) {
      var p = s.split('|'); Db.insert('payment_methods', { name: p[0], code: p[1], is_active: 1 });
    });

    var salt = newSalt_();
    Db.insert('users', { role_id: admin.id, username: adminUser, password_hash: hashPassword_(adminPass, salt), salt: salt,
      full_name: 'Administrator', is_active: 1, failed_login_attempts: 0 });
    audit_(null, 'setup_completed', 'system', 'hotels', 1);
  });
  // The password lives in script properties only for first-run; remove it now.
  props.deleteProperty('ADMIN_PASSWORD');
  return 'Setup complete. You can now sign in as ' + adminUser + '. ADMIN_PASSWORD was removed from script properties.';
}

/** Optional: adds a few sample room types and rooms so you can try the app. */
function addSampleRooms() {
  withLock_(function () {
    if (Db.all('rooms').length) throw new Error('Rooms already exist.');
    var std = Db.insert('room_types', { name: 'Standard', base_rate: 250, max_occupancy: 2, description: 'Standard room', is_active: 1 });
    var dlx = Db.insert('room_types', { name: 'Deluxe', base_rate: 400, max_occupancy: 3, description: 'Deluxe room', is_active: 1 });
    ['101','102','103','104'].forEach(function (n) { Db.insert('rooms', { room_type_id: std.id, room_number: n, floor: '1', status: 'available', is_active: 1 }); });
    ['201','202'].forEach(function (n) { Db.insert('rooms', { room_type_id: dlx.id, room_number: n, floor: '2', status: 'available', is_active: 1 }); });
  });
}

/** Run once after updating from an older version: gives existing Manager/Front Desk roles the new permissions. */
function upgradeDatabase() {
  withLock_(function () {
    Db.ensureAll();
    function grant(roleName, codes) {
      var r = Db.findBy('roles', { name: roleName }); if (!r) return;
      codes.forEach(function (c) { if (!Db.findBy('role_permissions', function (x) { return x.role_id === r.id && x.permission_code === c; })) Db.insert('role_permissions', { role_id: r.id, permission_code: c }); });
    }
    grant('Manager', ['invoicing.print', 'restaurant.view', 'restaurant.manage', 'restaurant.transact']);
    grant('Front Desk', ['invoicing.print', 'restaurant.view', 'restaurant.transact']);
  });
  return 'Upgrade complete.';
}

/** Optional sample restaurant data. */
function addSampleRestaurant() {
  withLock_(function () {
    if (Db.all('restaurant_menu_items').length) throw new Error('Menu already exists.');
    ['Table 1', 'Table 2', 'Table 3', 'Patio 1'].forEach(function (n) { Db.insert('restaurant_tables', { name: n, is_active: 1 }); });
    var food = Db.insert('restaurant_categories', { name: 'Mains' }), drinks = Db.insert('restaurant_categories', { name: 'Drinks' });
    [['Jollof Rice & Chicken', 65, food.id], ['Grilled Tilapia', 85, food.id], ['Fried Rice', 55, food.id], ['Bottled Water', 10, drinks.id], ['Soft Drink', 15, drinks.id]]
      .forEach(function (x) { Db.insert('restaurant_menu_items', { name: x[0], price: x[1], category_id: x[2], is_active: 1 }); });
  });
}

/**
 * Locked out? Set script properties RESET_USERNAME and RESET_PASSWORD, run this once from the editor.
 * It sets that user's password, unlocks the account, re-enables it and signs it out everywhere,
 * then deletes RESET_PASSWORD. Only someone with edit access to the script can do this.
 */
function resetUserPassword() {
  var props = PropertiesService.getScriptProperties();
  var name = props.getProperty('RESET_USERNAME'), pw = props.getProperty('RESET_PASSWORD');
  if (!name || !pw) throw new Error('Set script properties RESET_USERNAME and RESET_PASSWORD first.');
  validatePassword_(pw);
  var msg = withLock_(function () {
    var u = Db.findBy('users', function (x) { return x.username.toLowerCase() === String(name).toLowerCase(); });
    if (!u) throw new Error('No user named ' + name + '.');
    var salt = newSalt_();
    Db.update('users', u.id, { salt: salt, password_hash: hashPassword_(pw, salt), failed_login_attempts: 0, locked_until: '', is_active: 1 });
    Db.where('sessions', { user_id: u.id }).slice().reverse().forEach(function (s) { Db.remove('sessions', s.id); });
    audit_(null, 'password_reset_from_editor', 'security', 'users', u.id);
    return 'Password reset for ' + u.username + '.';
  });
  props.deleteProperty('RESET_PASSWORD');
  return msg;
}
