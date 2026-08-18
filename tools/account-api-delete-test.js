const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadHandler(scenario) {
  const deletedRefs = [];
  const deletedAuthUsers = [];
  const profiles = scenario.profile ? new Map([[scenario.uid, scenario.profile]]) : new Map();
  const firestore = {
    collection: (name) => ({
      doc: (id) => ({
        name,
        id,
        get: async () => {
          const profile = name === 'users' || name === 'staff_accounts' ? profiles.get(String(id)) : null;
          return { exists: !!profile, data: () => profile || {} };
        },
      }),
      where: () => ({ get: async () => ({ docs: [] }) }),
    }),
    batch: () => ({
      delete: (ref) => deletedRefs.push({ name: ref.name, id: ref.id }),
      commit: async () => {},
    }),
  };
  const auth = {
    getUser: async (uid) => {
      if (!scenario.authExists) throw Object.assign(new Error('auth/user-not-found'), { code: 'auth/user-not-found' });
      return { uid };
    },
    deleteUser: async (uid) => deletedAuthUsers.push(uid),
  };
  const api = { firestore: () => firestore, auth: () => auth };
  const adminLib = {
    getAdmin: () => api,
    authEmailForUsername: () => 'test@example.invalid',
    cleanPermissions: (value) => value || {},
    fullPermissions: () => ({}),
    requireManager: async () => ({ api, uid: 'manager' }),
    readProfile: async (_api, uid) => profiles.get(String(uid)) || null,
    writeProfilePair: async (_api, uid, profile) => profile,
    listProfiles: async () => [],
    sanitizeProfile: (uid, profile) => ({ id: uid, ...(profile || {}) }),
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
  return { handler: sandbox.module.exports, deletedRefs, deletedAuthUsers };
}

async function invoke(handler, body) {
  let status = 0;
  let payload = null;
  const res = {
    status(value) { status = value; return this; },
    setHeader() { return this; },
    end(value) { payload = JSON.parse(value); },
  };
  await handler({ method: 'POST', body, headers: { authorization: 'Bearer test' } }, res);
  return { status, payload };
}

(async () => {
  const uid = 'uid-existing';
  const existing = loadHandler({ uid, profile: { id: uid, role: 'موظف', status: 'نشط' }, authExists: true });
  const removed = await invoke(existing.handler, { action: 'delete', uid });
  assert.equal(removed.status, 200);
  assert.equal(removed.payload.deleted.alreadyRemoved, false);
  assert.deepEqual(existing.deletedRefs.map((ref) => `${ref.name}/${ref.id}`), [`users/${uid}`, `staff_accounts/${uid}`]);
  assert.deepEqual(existing.deletedAuthUsers, [uid]);

  const alreadyGone = loadHandler({ uid: 'uid-gone', profile: null, authExists: false });
  const retried = await invoke(alreadyGone.handler, { action: 'delete', uid: 'uid-gone' });
  assert.equal(retried.status, 200);
  assert.equal(retried.payload.deleted.alreadyRemoved, true);
  assert.deepEqual(alreadyGone.deletedRefs, []);

  console.log('PASS account-api-delete-test: existing and already-removed accounts delete idempotently without account-not-found failure.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
