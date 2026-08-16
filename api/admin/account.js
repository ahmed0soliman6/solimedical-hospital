const {
  getAdmin,
  authEmailForUsername,
  cleanPermissions,
  fullPermissions,
  requireManager,
  readProfile,
  writeProfilePair,
  listProfiles,
  sanitizeProfile,
} = require('../_lib/firebase-admin');

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

function publicProfile(profile) {
  const value = sanitizeProfile(profile.id, profile);
  delete value.password;
  delete value.passwordHash;
  return value;
}

function requirePassword(value) {
  const password = String(value || '');
  if (password.length < 6) {
    const error = new Error('auth/weak-password');
    error.status = 400;
    throw error;
  }
  return password;
}

async function ensureNotLastManager(api, uid, nextRole, nextStatus) {
  const current = await readProfile(api, uid);
  if (!current || current.role !== 'مدير' || nextRole === 'مدير' && nextStatus !== 'موقوف') return;
  const profiles = await listProfiles(api);
  const activeManagers = profiles.filter(profile => profile.id !== String(uid) && profile.role === 'مدير' && profile.status !== 'موقوف');
  if (!activeManagers.length) {
    const error = new Error('cannot-remove-last-manager');
    error.status = 409;
    throw error;
  }
}

async function createAccount(api, input) {
  const username = String(input.username || '').trim().toLowerCase();
  const displayName = String(input.displayName || '').trim();
  const role = input.role === 'مدير' ? 'مدير' : 'موظف';
  const status = input.status === 'موقوف' ? 'موقوف' : 'نشط';
  if (!username || !displayName) {
    const error = new Error('missing-account-fields');
    error.status = 400;
    throw error;
  }
  const password = requirePassword(input.password);
  const authUser = await api.auth().createUser({
    email: authEmailForUsername(username),
    password,
    displayName,
    disabled: status === 'موقوف',
  });
  const now = new Date().toISOString();
  const profile = {
    id: authUser.uid,
    firebaseUid: authUser.uid,
    displayName,
    username,
    role,
    status,
    permissions: role === 'مدير' ? fullPermissions() : cleanPermissions(input.permissions),
    credentialVersion: 1,
    securityVersion: 1,
    createdAt: now.slice(0, 10),
    lastLogin: null,
    lastPasswordChangeAt: now,
    updatedAt: now,
  };
  try {
    await writeProfilePair(api, authUser.uid, profile);
  } catch (error) {
    await api.auth().deleteUser(authUser.uid).catch(() => {});
    throw error;
  }
  return profile;
}

async function updateAccount(api, input) {
  const uid = String(input.uid || '');
  if (!uid) {
    const error = new Error('missing-uid');
    error.status = 400;
    throw error;
  }
  const current = await readProfile(api, uid);
  if (!current) {
    const error = new Error('account-not-found');
    error.status = 404;
    throw error;
  }
  const nextRole = input.role === 'مدير' ? 'مدير' : (input.role === 'موظف' ? 'موظف' : current.role);
  const nextStatus = input.status === 'موقوف' ? 'موقوف' : (input.status === 'نشط' ? 'نشط' : current.status);
  await ensureNotLastManager(api, uid, nextRole, nextStatus);
  const now = new Date().toISOString();
  const password = String(input.password || '');
  const username = String(input.username || current.username).trim().toLowerCase();
  const displayName = String(input.displayName || current.displayName).trim();
  const sensitiveChange = password.length > 0 || nextRole !== current.role || nextStatus !== current.status || JSON.stringify(cleanPermissions(input.permissions || current.permissions)) !== JSON.stringify(cleanPermissions(current.permissions));
  const patch = {
    ...current,
    displayName,
    username,
    role: nextRole,
    status: nextStatus,
    permissions: nextRole === 'مدير' ? fullPermissions() : cleanPermissions(input.permissions || current.permissions),
    updatedAt: now,
  };
  if (sensitiveChange) {
    patch.credentialVersion = Number(current.credentialVersion || current.securityVersion || 1) + 1;
    patch.securityVersion = patch.credentialVersion;
  }
  if (password.length > 0) {
    requirePassword(password);
    patch.lastPasswordChangeAt = now;
  }
  const authPatch = { displayName, disabled: nextStatus === 'موقوف' };
  if (username && username !== current.username) authPatch.email = authEmailForUsername(username);
  if (password.length > 0) authPatch.password = password;
  await api.auth().updateUser(uid, authPatch);
  if (sensitiveChange) await api.auth().revokeRefreshTokens(uid);
  return writeProfilePair(api, uid, patch);
}

async function deleteAccount(api, input) {
  const uid = String(input.uid || '');
  if (!uid) throw Object.assign(new Error('missing-uid'), { status: 400 });
  const current = await readProfile(api, uid);
  if (!current) throw Object.assign(new Error('account-not-found'), { status: 404 });
  await ensureNotLastManager(api, uid, 'موظف', 'موقوف');
  const batch = api.firestore().batch();
  batch.delete(api.firestore().collection('users').doc(uid));
  batch.delete(api.firestore().collection('staff_accounts').doc(uid));
  await batch.commit();
  await api.auth().deleteUser(uid);
  return { id: uid };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' });
    const { api } = await requireManager(req);
    if (req.method === 'GET') return json(res, 200, { accounts: (await listProfiles(api)).map(publicProfile) });
    const input = bodyOf(req);
    let profile;
    if (input.action === 'create') profile = await createAccount(api, input);
    else if (input.action === 'update' || input.action === 'resetPassword' || input.action === 'toggleStatus' || input.action === 'permissions') profile = await updateAccount(api, input);
    else if (input.action === 'delete') return json(res, 200, { ok: true, deleted: await deleteAccount(api, input) });
    else return json(res, 400, { error: 'unknown-action' });
    return json(res, 200, { ok: true, account: publicProfile(profile) });
  } catch (error) {
    console.error('account-api-error', error.code || error.message || 'unknown');
    return json(res, Number(error.status) || 500, { error: error.code || error.message || 'account-operation-failed' });
  }
};
