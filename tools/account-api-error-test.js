const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const quotaError = Object.assign(new Error('Quota exceeded for Firestore writes'), { code: 8 });
const api = { firestore: () => ({}) };
const adminLib = {
  getAdmin: () => api,
  authEmailForUsername: () => 'test@example.invalid',
  cleanPermissions: (value) => value || {},
  fullPermissions: () => ({}),
  requireManager: async () => ({ api, uid: 'manager' }),
  readProfile: async () => { throw quotaError; },
  writeProfilePair: async () => null,
  listProfiles: async () => [],
  sanitizeProfile: (id, profile) => ({ id, ...(profile || {}) }),
  hashRecoveryCode: () => '',
  recoveryCodeMatches: () => false,
};
const sandbox = {
  console: { error() {}, log() {} },
  require: (request) => {
    if (request === '../_lib/firebase-admin') return adminLib;
    throw new Error(`Unexpected require: ${request}`);
  },
  module: { exports: {} },
  exports: {},
};
vm.runInNewContext(fs.readFileSync('api/admin/account.js', 'utf8'), sandbox, { filename: 'api/admin/account.js' });

(async () => {
  let status = 0;
  let payload = null;
  const res = {
    status(value) { status = value; return this; },
    setHeader() { return this; },
    end(value) { payload = JSON.parse(value); },
  };
  await sandbox.module.exports({
    method: 'POST',
    body: { action: 'permissions', uid: 'uid-worker', role: 'موظف', status: 'نشط', permissions: {} },
    headers: { authorization: 'Bearer test' },
  }, res);
  assert.equal(status, 503);
  assert.equal(payload.error, 'firestore-resource-exhausted');
  assert.equal(payload.retryable, true);
  console.log('PASS account-api-error-test: Firebase code 8 becomes a safe retryable 503 response.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
