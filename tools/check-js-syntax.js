const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('/home/ubuntu/mitali-repo/index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1])
  .filter((s) => s.trim());
for (let i = 0; i < scripts.length; i++) {
  try {
    new vm.Script(scripts[i], { filename: `index.html<script-${i + 1}>` });
    console.log(`OK index script ${i + 1}`);
  } catch (error) {
    console.error(`FAIL index script ${i + 1}: ${error.stack || error}`);
    process.exitCode = 1;
  }
}
const adapter = fs.readFileSync('/home/ubuntu/mitali-repo/firebase-store.js', 'utf8');
try {
  new vm.Script(adapter, { filename: 'firebase-store.js' });
  console.log('OK firebase-store.js');
} catch (error) {
  console.error(`FAIL firebase-store.js: ${error.stack || error}`);
  process.exitCode = 1;
}
