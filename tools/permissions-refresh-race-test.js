const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync('index.html', 'utf8');
const admin = fs.readFileSync('api/_lib/firebase-admin.js', 'utf8');
const pageStart = index.indexOf('function renderPermissionsPanel');
const pageEnd = index.indexOf('// توافق الروابط القديمة', pageStart);
assert.ok(pageStart >= 0 && pageEnd > pageStart, 'permissions panel block should exist');
const permissionsBlock = index.slice(pageStart, pageEnd);

assert.match(index, /let ADMIN_ACCOUNTS_REFRESH_PROMISE = null;/);
assert.match(index, /let ADMIN_ACCOUNTS_REFRESH_REQUESTED = false;/);
assert.match(index, /return ADMIN_ACCOUNTS_REFRESH_PROMISE;/);
assert.match(index, /let ADMIN_ACCOUNTS_REFRESH_LAST_ERROR = "";/);
assert.match(index, /const ADMIN_ACCOUNTS_REFRESH_TIMEOUT_MS = 12000;/);
assert.match(index, /admin-accounts-refresh-timeout/);
assert.match(index, /let ADMIN_ACCOUNTS_REFRESH_SKIP_NEXT_RENDER = false;/);
assert.match(index, /if \(!skipRefresh\) refreshAccountsFromAdminApi\(true\);/);
assert.match(index, /a\.permissions\[m\.key\]\[act\.key\] === undefined\) \{ a\.permissions\[m\.key\]\[act\.key\] = false;/);
assert.match(permissionsBlock, /target \? \(refreshing \?/);
assert.match(permissionsBlock, /await refreshAccountsFromAdminApi\(false\);/);
assert.match(permissionsBlock, /const updated = response && response\.account;/);
assert.match(admin, /operations: \['view', 'add', 'edit', 'delete'\]/);
assert.match(admin, /labs: \['view', 'add', 'edit', 'delete'\]/);

console.log('PASS permissions-refresh-race-test: account refresh requests are serialized and operations/labs permission fields remain in the server allow-list.');
