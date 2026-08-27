"use strict";

const { onDocumentWrittenWithAuthContext } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const { changedFields, operationFor, sourceContext, auditId } = require("./audit");

const MONITORED_COLLECTIONS = Object.freeze([
  "users",
  "doctors",
  "employees",
  "visits_clinic",
  "visits_dental",
  "visits_operations",
  "visits_labs",
  "visits_radiology",
  "income",
  "expense",
  "payroll",
  "lab_expenses",
  "categories",
  "specialties",
  "settings",
]);

function snapshotData(snapshot) {
  return snapshot && snapshot.exists ? snapshot.data() : null;
}

function safeAuthType(value) {
  const allowed = new Set(["user", "system", "unknown", "unauthenticated"]);
  return allowed.has(String(value)) ? String(value) : "unknown";
}

function buildEntry(event, collection) {
  const before = snapshotData(event.data && event.data.before);
  const after = snapshotData(event.data && event.data.after);
  const authType = safeAuthType(event.authType);
  const sourcePath = event.data && event.data.after && event.data.after.ref
    ? event.data.after.ref.path
    : event.data && event.data.before && event.data.before.ref
      ? event.data.before.ref.path
      : `${collection}/${String(event.params && event.params.docId || "unknown")}`;
  const eventTime = String(event.time || new Date().toISOString());
  const operation = operationFor(before, after);
  const actorId = authType === "user" ? String(event.authId || "") || null : null;

  return {
    eventId: String(event.id || `${collection}:${sourcePath}:${eventTime}`),
    eventTime,
    operation,
    sourceCollection: collection,
    sourcePath,
    actorId,
    actorType: authType,
    changedFields: changedFields(before, after),
    // These fields keep the existing auditlog screen compatible. Deliberately
    // do not store old/new medical or financial values in the audit document.
    date: eventTime.slice(0, 10),
    time: eventTime.slice(11, 19),
    action: `${operation}:${collection}`,
    page: collection,
    userId: actorId,
    userName: actorId || authType,
    oldValue: "",
    newValue: "",
    device: "server-trigger",
    metadata: {
      ...sourceContext(before, after),
      beforeExists: Boolean(before),
      afterExists: Boolean(after),
    },
  };
}

function makeAuditTrigger(collection) {
  return onDocumentWrittenWithAuthContext(
    {
      document: `${collection}/{docId}`,
      region: "us-central1",
      retry: true,
      memory: "256MiB",
      timeoutSeconds: 60,
    },
    async (event) => {
      if (!event.data || (!event.data.before.exists && !event.data.after.exists)) return null;

      const entry = buildEntry(event, collection);
      // The event ID is stable across retries. A deterministic document ID plus
      // create() makes the trigger idempotent without overwriting old entries.
      const { getFirestore, FieldValue } = require("firebase-admin/firestore");
      const ref = getFirestore().collection("audit_log").doc(auditId(`trigger:${entry.eventId}`));

      try {
        await ref.create({
          schemaVersion: 1,
          eventId: entry.eventId,
          operation: entry.operation,
          sourceCollection: entry.sourceCollection,
          sourcePath: entry.sourcePath,
          actorId: entry.actorId,
          actorType: entry.actorType,
          changedFields: entry.changedFields,
          date: entry.date,
          time: entry.time,
          action: entry.action,
          page: entry.page,
          userId: entry.userId,
          userName: entry.userName,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          device: entry.device,
          metadata: entry.metadata,
          timestamp: entry.eventTime,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { logged: true, auditId: ref.id };
      } catch (error) {
        if (error && (error.code === 6 || error.code === "already-exists")) {
          logger.info("Audit event already recorded", { eventId: entry.eventId, collection });
          return { logged: true, duplicate: true, auditId: ref.id };
        }
        logger.error("Audit log write failed", {
          eventId: entry.eventId,
          collection,
          error: error && error.message ? error.message : String(error),
        });
        throw error;
      }
    },
  );
}

for (const collection of MONITORED_COLLECTIONS) {
  exports[`audit_${collection}`] = makeAuditTrigger(collection);
}

