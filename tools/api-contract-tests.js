#!/usr/bin/env node
const assert = require('node:assert/strict');
const { authEmailForUsername, cleanPermissions, sanitizeProfile } = require('../api/_lib/firebase-admin');

assert.equal(authEmailForUsername(' Ahmed '), 'u-YWhtZWQ@accounts.mitali-hospital.internal');
const permissions = cleanPermissions({ users: { edit: true, unknown: true }, reports: { view: true } });
assert.equal(permissions.users.edit, true);
assert.equal(permissions.users.unknown, undefined);
assert.equal(permissions.reports.view, true);
const profile = sanitizeProfile('uid-1', { displayName: 'موظف', username: 'worker', role: 'موظف', status: 'نشط', password: 'never-returned', permissions });
assert.equal(profile.id, 'uid-1');
assert.equal(profile.credentialVersion, 1);
assert.equal(Object.prototype.hasOwnProperty.call(profile, 'password'), false);
assert.equal(Object.prototype.hasOwnProperty.call(profile, 'passwordHash'), false);
console.log('PASS api-contract-tests: account identity, permission allow-list, and secret-free profile output.');
