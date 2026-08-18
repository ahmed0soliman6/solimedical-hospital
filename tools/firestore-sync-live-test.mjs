const projectId = 'mitali-hospital';
const apiKey = 'AIzaSyCPfbtk7Sodm6eAzDoFx-AbrrhfHGlOemE';
const password = process.env.FIREBASE_ADMIN_PASSWORD;
if (!password) throw new Error('FIREBASE_ADMIN_PASSWORD is required');
function authEmail(username) {
  const bytes = new TextEncoder().encode(username);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `u-${Buffer.from(binary, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}@accounts.mitali-hospital.internal`;
}
async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}
const auth = await request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: authEmail('admin'), password, returnSecureToken: true }),
});
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const path = `_sync_phase4_test/${Date.now().toString(36)}`;
const headers = { Authorization: `Bearer ${auth.idToken}`, 'content-type': 'application/json' };
const doc = `${base}/${path}`;
await request(doc, { method: 'PATCH', headers, body: JSON.stringify({ fields: { status: { stringValue: 'created' }, version: { integerValue: '1' } } }) });
const created = await request(doc, { headers });
if (created.fields?.status?.stringValue !== 'created') throw new Error('create/read mismatch');
await request(doc, { method: 'PATCH', headers, body: JSON.stringify({ fields: { status: { stringValue: 'updated' }, version: { integerValue: '2' } } }) });
const updated = await request(doc, { headers });
if (updated.fields?.status?.stringValue !== 'updated') throw new Error('update/read mismatch');
await request(doc, { method: 'DELETE', headers });
const verify = await fetch(doc, { headers });
if (verify.status !== 404) throw new Error(`delete verification returned ${verify.status}`);
const legacy = await request(`${base}/staff_accounts?pageSize=300`, { headers });
console.log(JSON.stringify({ ok: true, testedDocument: path, staffAccountsRemaining: (legacy.documents || []).length }, null, 2));
