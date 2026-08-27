"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const required = ["index.html", "styles.css", "app.js", "manifest.webmanifest"];
for (const name of required) {
  if (!fs.existsSync(path.join(root, name))) throw new Error(`Missing required file: ${name}`);
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "app.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));

if (!html.includes("./app.js") || !html.includes("./styles.css")) throw new Error("index.html is missing local assets");
if (!css.includes(".login-shell") || !css.includes(".app-shell")) throw new Error("styles.css is missing login/dashboard layouts");
if (!js.includes('username: "admin"') || !js.includes("PBKDF2") || !js.includes("localStorage")) throw new Error("local login contract is missing");
if (/MitaliFirebase|firebase-store|mitali1\.vercel\.app|mitali-hospital|mitali\.hospital/i.test(js)) throw new Error("local app still contains an external Firebase/Mitali reference");
if (manifest.name !== "SoliMedical Hospital" || manifest.lang !== "ar" || manifest.dir !== "rtl") throw new Error("manifest identity is invalid");

new vm.Script(js, { filename: "app.js" });
console.log("PASS local-app-check: local assets, Arabic manifest, PBKDF2 login, and no Firebase/Mitali references.");
