"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const required = ["index.html", "manifest.webmanifest"];
for (const name of required) {
  if (!fs.existsSync(path.join(root, name))) throw new Error(`Missing required file: ${name}`);
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
const cssMatch = html.match(/<style id="solimedical-styles">([\s\S]*?)<\/style>/);
const jsMatch = html.match(/<script id="solimedical-app">([\s\S]*?)<\/script>/);
const css = cssMatch?.[1] || "";
const js = jsMatch?.[1] || "";

if (html.includes("./app.js") || html.includes("./features.js") || html.includes("./styles.css")) throw new Error("index.html still references external application assets");
if (!css.includes(".login-shell") || !css.includes(".app-shell") || !css.includes(".patient-workspace")) throw new Error("inline CSS is missing core layouts");
if (!js.includes('username: "admin"') || !js.includes("PBKDF2") || !js.includes("localStorage") || !js.includes("soliPatientsPage")) throw new Error("inline local app contract is missing");
if (/MitaliFirebase|firebase-store|mitali1\.vercel\.app|mitali-hospital|mitali\.hospital/i.test(js)) throw new Error("local app still contains an external Firebase/Mitali reference");
if (manifest.name !== "SoliMedical Hospital" || manifest.lang !== "ar" || manifest.dir !== "rtl") throw new Error("manifest identity is invalid");

new vm.Script(js, { filename: "index-inline-app.js" });
console.log("PASS local-app-check: single-file index, inline CSS/JS, Arabic manifest, PBKDF2 login, patient records, and no Firebase/Mitali references.");
