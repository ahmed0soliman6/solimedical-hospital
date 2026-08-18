#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { authEmailForUsername, cleanPermissions, sanitizeProfile } = require('../api/_lib/firebase-admin');

assert.equal(authEmailForUsername(' Ahmed '), 'u-YWhtZWQ@accounts.mitali-hospital.internal');
const permissions = cleanPermissions({ dashboard: { view: true }, outstandingBalancesClinic: { view: true }, outstandingBalancesDental: { view: true }, outstandingBalancesOperations: { view: true }, outstandingBalancesLabs: { view: true }, outstandingBalancesRadiology: { view: true }, outstandingBalances: { view: true }, users: { edit: true, unknown: true }, reports: { view: true } });
assert.equal(permissions.dashboard.view, true);
assert.equal(permissions.outstandingBalancesClinic.view, true);
assert.equal(permissions.outstandingBalancesDental.view, true);
assert.equal(permissions.outstandingBalancesOperations.view, true);
assert.equal(permissions.outstandingBalancesLabs.view, true);
assert.equal(permissions.outstandingBalancesRadiology.view, true);
assert.equal(permissions.outstandingBalances.view, true);
assert.equal(permissions.users.edit, true);
assert.equal(permissions.users.unknown, undefined);
assert.equal(permissions.reports.view, true);
const profile = sanitizeProfile('uid-1', { displayName: 'موظف', username: 'worker', role: 'موظف', status: 'نشط', password: 'never-returned', permissions });
assert.equal(profile.id, 'uid-1');
assert.equal(profile.credentialVersion, 1);
assert.equal(Object.prototype.hasOwnProperty.call(profile, 'password'), false);
assert.equal(Object.prototype.hasOwnProperty.call(profile, 'passwordHash'), false);
const indexSource = fs.readFileSync('index.html', 'utf8');
assert.match(indexSource, /const postLoginKeys = CORE_BOOT_KEYS\.filter\(key => key !== "staffAccounts"\)/);
assert.match(indexSource, /permissions: perms \}, "permissions"\)/);
console.log('PASS api-contract-tests: account identity, permission allow-list, secret-free profile output, and client permission refresh contract.');
