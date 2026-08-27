"use strict";

const crypto = require("node:crypto");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) initializeApp();

const db = getFirestore();
const AUDIT_COLLECTION = "audit_log";
const MAX_FIELDS = 100;

const REDACTED_KEYS = new Set([
  "password",
  "passwordHash",
  "recoveryCode",
  "codeHash",
  "token",
  "accessToken",
  "refreshToken",
  "privateKey",
  "secret",
  "apiKey",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function stableJson(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function changedFields(before, after, prefix = "", output = []) {
  if (output.length >= MAX_FIELDS) return output;
  const left = before && typeof before === "object" ? before : {};
  const right = after && typeof after === "object" ? after : {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const key of keys) {
    if (REDACTED_KEYS.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const oldValue = left[key];
    const newValue = right[key];
    if (stableJson(oldValue) === stableJson(newValue)) continue;

    const bothObjects = oldValue && newValue
      && typeof oldValue === "object"
      && typeof newValue === "object"
      && !Array.isArray(oldValue)
      && !Array.isArray(newValue);

    if (bothObjects) changedFields(oldValue, newValue, path, output);
    else output.push(path);
    if (output.length >= MAX_FIELDS) break;
  }
  return output;
}

function operationFor(before, after) {
  if (!before && after) return "create";
  if (before && !after) return "delete";
  return "update";
}

function safeText(value, max = 180) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, max);
}

function auditId(seed) {
  return sha256(seed).slice(0, 40);
}

function sourceContext(before, after) {
  const source = after || before || {};
  return {
    hospitalId: safeText(source.hospitalId || source.tenantId, 100),
    branchId: safeText(source.branchId, 100),
  };
}

/**
 * Used by trusted server endpoints for actions that do not carry a client
 * authentication context, such as account administration and data wiping.
 * Never pass raw request bodies or medical values to this function.
 */
async function recordAdminAudit({
  actorUid = null,
  action,
  sourceCollection,
  sourcePath = null,
  changed = [],
  metadata = {},
  eventId = crypto.randomUUID(),
}) {
  const actorId = actorUid ? safeText(actorUid, 160) : null;
  let actorDisplayName = null;
  if (actorUid) {
    try {
      const user = await getAuth().getUser(String(actorUid));
      actorDisplayName = safeText(user.displayName, 160);
    } catch (error) {
      // Do not fail the protected business operation because a display name
      // lookup failed. The immutable actor UID remains in the audit record.
    }
  }

  const cleanMetadata = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (REDACTED_KEYS.has(key)) continue;
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      cleanMetadata[key] = typeof value === "string" ? value.slice(0, 240) : value;
    }
  }

  const entry = {
    schemaVersion: 1,
    eventId: safeText(eventId, 180),
    operation: safeText(action, 80) || "admin-action",
    sourceCollection: safeText(sourceCollection, 100),
    sourcePath: safeText(sourcePath, 240),
    actorId,
    actorType: "trusted-server",
    actorDisplayName,
    changedFields: Array.from(new Set((Array.isArray(changed) ? changed : []).map((x) => safeText(x, 120)).filter(Boolean))).slice(0, MAX_FIELDS),
    metadata: cleanMetadata,
    createdAt: FieldValue.serverTimestamp(),
  };

  const ref = db.collection(AUDIT_COLLECTION).doc(auditId(`server:${eventId}`));
  try {
    await ref.create(entry);
  } catch (error) {
    if (error && (error.code === 6 || error.code === "already-exists")) return ref.id;
    throw error;
  }
  return ref.id;
}

module.exports = {
  AUDIT_COLLECTION,
  REDACTED_KEYS,
  stableJson,
  sha256,
  changedFields,
  operationFor,
  sourceContext,
  auditId,
  recordAdminAudit,
};
