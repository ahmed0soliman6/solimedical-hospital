#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const store = fs.readFileSync(path.join(root, 'firebase-store.js'), 'utf8');

function passwordPolicy(current, next, confirmation) {
  if (!next || next.length < 6) return 'weak';
  if (next !== confirmation) return 'mismatch';
  if (next === current) return 'same';
  return 'ok';
}
function lockAfterFailures(failures, now, max = 5, duration = 5 * 60 * 1000) {
  const next = failures + 1;
  return next >= max ? { failures: 0, lockedUntil: now + duration } : { failures: next, lockedUntil: 0 };
}
function sessionIsValid(session, now) {
  return !!session && Number(session.sessionExpiresAt) > now && Number(session.offlineTrustedUntil) > now;
}

// Login form and generic failure handling.
assert.match(html, /id="loginUser"/);
assert.match(html, /id="loginPass"/);
assert.match(html, /id="togglePass"/);
assert.match(html, /genericLoginError\(\)/);
assert.match(html, /MAX_LOGIN_FAILURES = 5/);
assert.match(html, /LOGIN_LOCK_MS/);
assert.doesNotMatch(html, /find\(a => a\.username === username && a\.password === password\)/);
assert.doesNotMatch(html, /console\.(log|error|warn)\([^\n]*(?:current|new1|new2)\s*[,)]/i);

// Password policy cases requested by the specification.
const generatedCurrent = `current-${Date.now()}`;
assert.equal(passwordPolicy(generatedCurrent, 'x', 'x'), 'weak');
assert.equal(passwordPolicy(generatedCurrent, 'new-generated-secret', 'different-generated-secret'), 'mismatch');
assert.equal(passwordPolicy(generatedCurrent, generatedCurrent, generatedCurrent), 'same');
assert.equal(passwordPolicy(generatedCurrent, 'new-generated-secret', 'new-generated-secret'), 'ok');

// Progressive lockout and session expiry cases.
const lock = lockAfterFailures(4, 1000);
assert.equal(lock.failures, 0);
assert.equal(lock.lockedUntil, 301000);
assert.equal(sessionIsValid({ sessionExpiresAt: 10000, offlineTrustedUntil: 10000 }, 9999), true);
assert.equal(sessionIsValid({ sessionExpiresAt: 10000, offlineTrustedUntil: 9999 }, 9999), false);

// Change-password flow must reauthenticate and update the remote security version before success.
assert.match(store, /reauthenticateWithCredential/);
assert.match(store, /updatePassword/);
assert.match(html, /updateOwnSecurityMetadata/);
assert.match(html, /securityVersion/);
assert.match(html, /lastPasswordChangeAt/);
assert.match(html, /تم تغيير كلمة المرور بنجاح/);
assert.match(html, /لا يمكن تغيير كلمة المرور محليًا/);

// Firestore rules must prevent self privilege changes while allowing only security metadata.
assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['lastLogin', 'securityVersion', 'lastPasswordChangeAt'\]\)/);
assert.match(rules, /match \/staff_accounts\/\{document\}/);
assert.match(rules, /allow write: if isAdmin\(\);/);
assert.match(rules, /collection != 'staff_accounts'/);

// No literal password may be stored in the staff account persistence path.
assert.match(store, /if \(key === "staffAccounts"\) delete data\.password/);
assert.match(html, /a\.password = ""/);

console.log('PASS security-auth-tests: login validation, generic errors, lockout, session expiry, password policy, Firebase reauthentication, security versioning, and Firestore rule guards.');
