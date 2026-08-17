const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const uid = 'uid-worker';
const current = {
  id: uid,
  firebaseUid: uid,
  displayName: 'موظف تجريبي',
  username: 'worker',
  role: 'موظف',
  status: 'نشط',
  credentialVersion: 2,
  securityVersion: 2,
  permissions: { dashboard: { view: true }, clinic: { view: false, add: false, edit: false, delete: false } },
};
let writtenProfile = null;
let authUpdate = null;
let revokedUid = null;
const api = {
  firestore: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => current }) }) }) }),
  auth: () => ({
    updateUser: async (id, patch) => { authUpdate = { id, patch }; },
    revokeRefreshTokens: async (id) => { revokedUid = id; },
  }),
};
const adminLib = {
  getAdmin: () => api,
  authEmailForUsername: () => 'test@example.invalid',
  cleanPermissions: (value) => value || {},
  fullPermissions: () => ({}),
  requireManager: async () => ({ api, uid: 'manager' }),
  readProfile: async () => ({ ...current }),
  writeProfilePair: async (_api, id, profile) => { writtenProfile = { id, profile }; return profile; },
  listProfiles: async () => [{ id: 'manager', role: 'مدير', status: 'نشط' }],
  sanitizeProfile: (id, profile) => ({ id, ...(profile || {}) }),
  hashRecoveryCode: () => '',
  recoveryCodeMatches: () => false,
};
const sandbox = {
  console,
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
    body: {
      action: 'permissions', uid,
      displayName: current.displayName, username: current.username,
      role: 'موظف', status: 'نشط',
      permissions: { dashboard: { view: true }, clinic: { view: true, add: true, edit: false, delete: false } },
    },
    headers: { authorization: 'Bearer test' },
  }, res);

  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.equal(writtenProfile.id, uid);
  assert.equal(writtenProfile.profile.permissions.clinic.add, true);
  assert.equal(writtenProfile.profile.credentialVersion, 3);
  assert.equal(writtenProfile.profile.securityVersion, 3);
  assert.equal(authUpdate.id, uid);
  assert.equal(revokedUid, uid);
  console.log('PASS account-api-permissions-test: permission updates are persisted before the success response and invalidate trusted sessions.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
