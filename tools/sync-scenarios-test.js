const assert = require('node:assert/strict');

function createOutbox(remote) {
  const local = new Map();
  const baseline = new Map();
  const pending = new Set();
  const queues = new Map();
  let online = true;
  let failNext = false;
  let writes = 0;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const upload = async (key) => {
    if (!online) { pending.add(key); return; }
    if (failNext) { failNext = false; pending.add(key); throw new Error('temporary-network-failure'); }
    writes += 1;
    remote.set(key, clone(local.get(key)));
    baseline.set(key, clone(local.get(key)));
    pending.delete(key);
  };
  const persist = (key, value) => {
    const previous = queues.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      local.set(key, clone(value));
      pending.add(key);
      await upload(key);
    });
    queues.set(key, run);
    return run;
  };
  const flush = async () => {
    if (!online) return;
    for (const key of [...pending]) await upload(key);
  };
  const remoteRead = (key) => {
    const snapshot = clone(remote.get(key));
    if (pending.has(key)) return clone(local.get(key));
    return snapshot;
  };
  return { local, baseline, pending, get writes() { return writes; }, remote, set online(value) { online = value; }, failNext() { failNext = true; }, persist, flush, remoteRead, equal };
}

(async () => {
  const remote = new Map([['visitsClinic', [{ id: 'existing', name: 'قديم' }]]]);
  const outbox = createOutbox(remote);

  outbox.online = false;
  await outbox.persist('visitsClinic', [{ id: 'existing', name: 'قديم' }, { id: 'offline-1', name: 'محلي' }]);
  assert(outbox.pending.has('visitsClinic'));
  assert.equal(remote.get('visitsClinic').length, 1);
  assert.equal(outbox.baseline.has('visitsClinic'), false);

  // لقطة قديمة أثناء التعليق لا تمحو السجل المحلي ولا تؤكده في baseline.
  const protectedSnapshot = outbox.remoteRead('visitsClinic');
  assert.equal(protectedSnapshot.length, 2);
  assert.equal(outbox.baseline.has('visitsClinic'), false);

  outbox.online = true;
  await outbox.flush();
  assert.equal(outbox.pending.size, 0);
  assert.equal(remote.get('visitsClinic').length, 2);
  assert.equal(outbox.baseline.get('visitsClinic').length, 2);

  // تعديلان سريعان لنفس الجدول يخرجان بترتيب واحد والنتيجة الأخيرة لا تُمحى.
  await Promise.all([
    outbox.persist('visitsClinic', [...remote.get('visitsClinic'), { id: 'fast-1' }]),
    outbox.persist('visitsClinic', [...remote.get('visitsClinic'), { id: 'fast-1' }, { id: 'fast-2' }]),
  ]);
  assert.equal(remote.get('visitsClinic').length, 4);
  assert.equal(remote.get('visitsClinic')[3].id, 'fast-2');

  // الفشل لا يمسح pending ولا يغيّر baseline؛ retry يرفع أحدث قيمة مرة واحدة.
  outbox.failNext();
  await assert.rejects(outbox.persist('visitsClinic', [...remote.get('visitsClinic'), { id: 'retry-1' }]));
  assert(outbox.pending.has('visitsClinic'));
  assert.equal(outbox.baseline.get('visitsClinic').some((r) => r.id === 'retry-1'), false);
  await outbox.flush();
  assert.equal(outbox.pending.size, 0);
  assert.equal(remote.get('visitsClinic').some((r) => r.id === 'retry-1'), true);

  // إعادة الرفع idempotent: لا يتكرر السجل عند flush إضافي.
  const beforeWrites = outbox.writes;
  await outbox.flush();
  assert.equal(outbox.writes, beforeWrites);
  assert.equal(new Set(remote.get('visitsClinic').map((r) => r.id)).size, remote.get('visitsClinic').length);

  console.log('PASS sync-scenarios-test: offline queue, stale snapshot protection, serialized writes, retry, and idempotent flush.');
})();
