const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const calls = [];
const db = {
  enablePersistence: () => Promise.resolve(),
  collection: (name) => {
    calls.push({ type: 'collection', name });
    return {
      get: async () => {
        calls.push({ type: 'get', name });
        return { docs: [] };
      },
      doc: (id) => ({
        set: async (data, options) => calls.push({ type: 'set', name, id, data, options }),
      }),
    };
  },
};
const auth = { onAuthStateChanged: (callback) => { callback(null); return () => {}; } };
const app = {};
const firebase = {
  apps: [],
  initializeApp: () => app,
  app: () => app,
  firestore: () => db,
  auth: () => auth,
};
const context = {
  console,
  window: { firebase },
  setTimeout,
  clearTimeout,
  Promise,
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync('firebase-store.js', 'utf8'), context, { filename: 'firebase-store.js' });

(async () => {
  await context.window.MitaliFirebase.setValue('settings', { openingBalance: 1250 });
  await context.window.MitaliFirebase.setValue('specialties', ['باطنة']);
  await context.window.MitaliFirebase.setValue('categories', { income: ['كشف'] });

  assert.equal(calls.filter((call) => call.type === 'get').length, 0);
  assert.deepEqual(calls.filter((call) => call.type === 'set').map((call) => call.name), ['settings', 'specialties', 'categories']);
  assert.deepEqual(calls.filter((call) => call.type === 'set').map((call) => call.id), ['app', 'app', 'app']);
  console.log('PASS store-setvalue-performance-test: singleton settings, specialties, and categories use direct app-document upsert without collection.get().');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
