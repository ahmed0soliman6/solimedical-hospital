const admin = require('firebase-admin');
const crypto = require('crypto');

function normalizePrivateKey(rawValue) {
  let value = String(rawValue || '').trim();
  if (!value) return '';
  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      value = String(parsed.private_key || '');
    } catch (error) {
      // Fall through to the normal validation below so no secret is logged.
    }
  } else if (value.startsWith('"') && value.endsWith('"')) {
    try { value = JSON.parse(value); } catch (error) { /* keep raw value */ }
  }
  return value
    .replace(/\\\\n/g, '\n')
    .replace(/\\\\r/g, '\r')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();
}

function getAdmin() {
  if (admin.apps.length) return admin;
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'mitali-hospital';
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!clientEmail || !privateKey || !privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
    const error = new Error('Firebase Admin credentials are not configured correctly');
    error.code = 'server-misconfigured';
    throw error;
  }
  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
  return admin;
}

function authEmailForUsername(username) {
  const encoded = Buffer.from(String(username || '').trim().toLowerCase(), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `u-${encoded}@accounts.mitali-hospital.internal`;
}

function cleanPermissions(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  const modules = {
    dashboard: ['view'],
    doctors: ['view', 'add', 'edit', 'delete'],
    employees: ['view', 'add', 'edit', 'delete'],
    clinic: ['view', 'add', 'edit', 'delete'],
    dental: ['view', 'add', 'edit', 'delete'],
    operations: ['view', 'add', 'edit', 'delete'],
    labs: ['view', 'add', 'edit', 'delete'],
    radiology: ['view', 'add', 'edit', 'delete'],
    patientFilesClinic: ['view'],
    patientFilesDental: ['view'],
    income: ['view', 'add', 'edit', 'delete'],
    expense: ['view', 'add', 'edit', 'delete'],
    ledger: ['view'],
    outstandingBalancesClinic: ['view'],
    outstandingBalancesDental: ['view'],
    outstandingBalancesOperations: ['view'],
    outstandingBalancesLabs: ['view'],
    outstandingBalancesRadiology: ['view'],
    outstandingBalances: ['view'],
    reports: ['view'],
    payroll: ['view', 'add', 'edit', 'delete'],
    categories: ['view', 'add', 'edit', 'delete'],
    users: ['view', 'add', 'edit', 'delete', 'editPerms'],
    settings: ['edit', 'backup', 'restore'],
    demoData: ['view'],
  };
  for (const [module, actions] of Object.entries(modules)) {
    result[module] = {};
    for (const action of actions) result[module][action] = !!(source[module] && source[module][action]);
  }
  return result;
}

function hashRecoveryCode(code, salt) {
  return crypto.pbkdf2Sync(String(code || ''), String(salt || ''), 120000, 32, 'sha256').toString('hex');
}

function recoveryCodeMatches(code, salt, expectedHash) {
  const actual = Buffer.from(hashRecoveryCode(code, salt), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function fullPermissions() {
  const source = {};
  for (const key of Object.keys(cleanPermissions({}))) source[key] = {};
  const result = cleanPermissions(source);
  for (const module of Object.keys(result)) for (const action of Object.keys(result[module])) result[module][action] = true;
  return result;
}

function sanitizeProfile(uid, data) {
  const source = data || {};
  return {
    id: String(uid),
    firebaseUid: String(uid),
    displayName: String(source.displayName || ''),
    username: String(source.username || '').trim().toLowerCase(),
    role: source.role === 'مدير' ? 'مدير' : 'موظف',
    status: source.status === 'موقوف' ? 'موقوف' : 'نشط',
    permissions: cleanPermissions(source.permissions),
    securityVersion: Number(source.securityVersion || source.credentialVersion || 1),
    credentialVersion: Number(source.credentialVersion || source.securityVersion || 1),
    createdAt: source.createdAt || new Date().toISOString().slice(0, 10),
    lastLogin: source.lastLogin || null,
    lastPasswordChangeAt: source.lastPasswordChangeAt || null,
    updatedAt: source.updatedAt || new Date().toISOString(),
  };
}

async function requireManager(req) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }
  const api = getAdmin();
  const decoded = await api.auth().verifyIdToken(token);
  const snapshot = await api.firestore().collection('users').doc(decoded.uid).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || profile.status === 'موقوف' || profile.role !== 'مدير') {
    const error = new Error('Manager access required');
    error.status = 403;
    throw error;
  }
  return { api, uid: decoded.uid, profile };
}

async function readProfile(api, uid) {
  const normalizedUid = String(uid);
  const usersSnap = await api.firestore().collection('users').doc(normalizedUid).get();
  if (usersSnap.exists) return sanitizeProfile(normalizedUid, usersSnap.data());
  const staffSnap = await api.firestore().collection('staff_accounts').doc(normalizedUid).get();
  if (staffSnap.exists) return sanitizeProfile(normalizedUid, staffSnap.data());
  // دعم السجلات القديمة التي كان معرّف مستندها محليًا بينما حقل firebaseUid
  // يحتوي على معرّف Firebase الحقيقي.
  for (const collectionName of ['users', 'staff_accounts']) {
    const matches = await api.firestore().collection(collectionName)
      .where('firebaseUid', '==', normalizedUid).limit(1).get();
    if (!matches.empty) return sanitizeProfile(normalizedUid, matches.docs[0].data());
  }
  return null;
}

async function writeProfilePair(api, uid, profile) {
  const data = sanitizeProfile(uid, profile);
  const safeData = {
    ...data,
    password: api.firestore.FieldValue.delete(),
    passwordHash: api.firestore.FieldValue.delete(),
  };
  const batch = api.firestore().batch();
  batch.set(api.firestore().collection('users').doc(String(uid)), safeData, { merge: true });
  batch.set(api.firestore().collection('staff_accounts').doc(String(uid)), safeData, { merge: true });
  await batch.commit();
  return data;
}

async function listProfiles(api) {
  const [usersSnap, staffSnap] = await Promise.all([
    api.firestore().collection('users').get(),
    api.firestore().collection('staff_accounts').get(),
  ]);
  const byUid = new Map();
  for (const doc of [...staffSnap.docs, ...usersSnap.docs]) {
    const data = doc.data() || {};
    const uid = String(data.firebaseUid || doc.id);
    const profile = sanitizeProfile(uid, data);
    // users هو المصدر المفضل عند وجود النسختين، لأنه يُقرأ أولًا عند تسجيل الدخول.
    if (!byUid.has(uid) || doc.ref?.parent?.id === 'users' || doc.id === uid) byUid.set(uid, profile);
  }
  return Array.from(byUid.values());
}

module.exports = {
  admin,
  getAdmin,
  authEmailForUsername,
  cleanPermissions,
  fullPermissions,
  sanitizeProfile,
  requireManager,
  readProfile,
  writeProfilePair,
  listProfiles,
  hashRecoveryCode,
  recoveryCodeMatches,
};
