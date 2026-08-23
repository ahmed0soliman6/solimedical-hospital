const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('firebase-store.js', 'utf8');
const requestBlock = source.slice(source.indexOf('async function adminAccountRequest'), source.indexOf('async function adminCreateAccount'));
const listBlock = source.slice(source.indexOf('async function adminListAccounts'), source.indexOf('async function adminDeleteAccount'));

assert.match(source, /async function fetchWithTimeout\(url, options = \{\}, timeoutMs = 12000\)/);
assert.match(source, /admin-api-timeout/);
assert.doesNotMatch(requestBlock, /getIdToken\(true\)/);
assert.doesNotMatch(listBlock, /getIdToken\(true\)/);
assert.match(requestBlock, /fetchWithTimeout\(apiUrl\('\/api\/admin\/account'\)/);
assert.match(listBlock, /fetchWithTimeout\(apiUrl\('\/api\/admin\/account'\)/);
console.log('PASS permissions-transport-performance-test: account API requests reuse cached Firebase tokens and abort stalled requests instead of forcing a network refresh.');
