/*
 * Mitali Hospital — Firebase Firestore adapter
 *
 * This adapter deliberately does not replace Supabase by itself. The main app
 * enables it only after Firestore Rules, Auth, and the migration have been
 * tested. No Admin SDK or service-account credential belongs in this file.
 */
(function () {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyCPfbtk7Sodm6eAzDoFx-AbrrhfHGlOemE",
    authDomain: "mitali-hospital.firebaseapp.com",
    projectId: "mitali-hospital",
    storageBucket: "mitali-hospital.firebasestorage.app",
    messagingSenderId: "285647848005",
    appId: "1:285647848005:web:33834414233c404781592c",
    measurementId: "G-MSXFTKDVKW"
  };

  const COLLECTIONS = {
    doctors: "doctors",
    employees: "employees",
    visitsClinic: "visits_clinic",
    visitsDental: "visits_dental",
    visitsOperations: "visits_operations",
    visitsLabs: "visits_labs",
    visitsRadiology: "visits_radiology",
    income: "income",
    expense: "expense",
    payroll: "payroll",
    staffAccounts: "staff_accounts",
    auditLog: "audit_log",
    labExpenses: "lab_expenses",
    categories: "categories",
    specialties: "specialties",
    settings: "settings"
  };

  let app = null;
  let db = null;
  let auth = null;
  let persistencePromise = null;
  let authReadyPromise = null;

  function init() {
    if (db) return db;
    if (!window.firebase || !window.firebase.initializeApp || !window.firebase.firestore) {
      throw new Error("Firebase Web SDK is not loaded");
    }
    app = window.firebase.apps && window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(firebaseConfig);
    db = window.firebase.firestore(app);
    auth = window.firebase.auth ? window.firebase.auth(app) : null;
    if (auth && auth.onAuthStateChanged) {
      authReadyPromise = new Promise((resolve) => {
        let unsubscribe = null;
        unsubscribe = auth.onAuthStateChanged((user) => {
          if (unsubscribe) unsubscribe();
          resolve(user || null);
        });
      });
    } else {
      authReadyPromise = Promise.resolve(null);
    }
    persistencePromise = db.enablePersistence({ synchronizeTabs: true }).catch((error) => {
      // Persistence may be unavailable when another tab owns the lease or when
      // the browser blocks IndexedDB. Firestore still works online in that case.
      console.warn("Firestore persistence unavailable; continuing online:", error.code || error.message || error);
    });
    return db;
  }

  async function ready() {
    init();
    await persistencePromise;
    return true;
  }

  async function waitForAuth() {
    init();
    return authReadyPromise ? await authReadyPromise : null;
  }

  function collectionName(key) {
    const name = COLLECTIONS[key];
    if (!name) throw new Error(`Unknown Firestore collection: ${key}`);
    return name;
  }

  function cleanDocument(value) {
    if (Array.isArray(value)) return value.map(cleanDocument);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      // Firestore rejects undefined values. Null is intentional and preserved.
      if (item !== undefined) out[key] = cleanDocument(item);
    }
    return out;
  }

  function safeRecord(key, record) {
    const data = Object.assign({}, record || {});
    // Passwords belong only to Firebase Authentication and must never be copied
    // into Firestore during the migration.
    if (key === "staffAccounts") delete data.password;
    return cleanDocument(data);
  }

  async function commitOperations(operations) {
    const CHUNK = 400;
    for (let i = 0; i < operations.length; i += CHUNK) {
      const batch = db.batch();
      operations.slice(i, i + CHUNK).forEach((operation) => {
        if (operation.type === "delete") batch.delete(operation.ref);
        else batch.set(operation.ref, operation.data, { merge: false });
      });
      await batch.commit();
    }
  }

  function authEmailForUsername(username) {
    const encoded = btoa(unescape(encodeURIComponent(String(username || '').trim().toLowerCase())))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return `u-${encoded}@accounts.mitali-hospital.internal`;
  }

  async function signInWithUsername(username, password) {
    init();
    if (!auth) throw new Error('Firebase Authentication SDK is not loaded');
    return auth.signInWithEmailAndPassword(authEmailForUsername(username), password);
  }

  async function createAuthUserForUsername(username, password) {
    init();
    if (!auth) throw new Error('Firebase Authentication SDK is not loaded');
    return auth.createUserWithEmailAndPassword(authEmailForUsername(username), password);
  }

  async function signOut() {
    init();
    if (auth) await auth.signOut();
  }

  function authUser() {
    init();
    return auth ? auth.currentUser : null;
  }

  async function getUserProfile(uid) {
    await ready();
    if (!auth || !auth.currentUser || auth.currentUser.uid !== uid) throw new Error('Firebase user is not authenticated');
    const snap = await db.collection('users').doc(String(uid)).get();
    return snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
  }

  async function getTable(key) {
    await ready();
    const snap = await db.collection(collectionName(key)).get();
    return snap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data()));
  }

  async function getValue(key, fallback) {
    const records = await getTable(key);
    if (!records.length) return fallback;
    if (key === "specialties") {
      const raw = Object.assign({}, records[0]);
      delete raw.id;
      if (Array.isArray(raw.value)) return raw.value;
      // Support the first migration format, which spread an array into
      // numeric document fields ("0", "1", ...).
      const numericKeys = Object.keys(raw)
        .filter((field) => /^\\d+$/.test(field))
        .sort((a, b) => Number(a) - Number(b));
      return numericKeys.length ? numericKeys.map((field) => raw[field]) : fallback;
    }
    if (key === "settings" || key === "categories") {
      const value = Object.assign({}, records[0]);
      delete value.id;
      return value;
    }
    return records;
  }

  async function setValue(key, value) {
    if (key === "specialties") {
      return setTable(key, [{ id: "app", value: Array.isArray(value) ? value : [] }]);
    }
    if (key === "settings" || key === "categories") {
      return setTable(key, [{ id: "app", ...(value || {}) }]);
    }
    return setTable(key, Array.isArray(value) ? value : []);
  }

  async function setTable(key, records) {
    await ready();
    if (!Array.isArray(records)) throw new Error(`Firestore table must be an array: ${key}`);
    const collection = db.collection(collectionName(key));
    const existing = await collection.get();
    const nextIds = new Set(records.map((record) => String(record.id)));
    const operations = [];

    // Replace the collection from the application's point of view. Operations
    // are chunked below Firestore's batch limit so large hospital tables migrate.
    existing.docs.forEach((doc) => {
      if (!nextIds.has(doc.id)) operations.push({ type: "delete", ref: doc.ref });
    });
    records.forEach((record) => {
      if (!record || !record.id) throw new Error(`Firestore record has no id: ${key}`);
      const data = safeRecord(key, record);
      delete data.id;
      operations.push({ type: "set", ref: collection.doc(String(record.id)), data });
    });
    await commitOperations(operations);
    return records;
  }

  async function upsertRecord(key, record) {
    await ready();
    if (!record || !record.id) throw new Error(`Firestore record has no id: ${key}`);
    const data = safeRecord(key, record);
    delete data.id;
    await db.collection(collectionName(key)).doc(String(record.id)).set(data, { merge: false });
    return record;
  }

  async function deleteRecords(key, ids) {
    await ready();
    const batch = db.batch();
    ids.forEach((id) => batch.delete(db.collection(collectionName(key)).doc(String(id))));
    await batch.commit();
  }

  function subscribe(key, onChange, onError) {
    init();
    return db.collection(collectionName(key)).onSnapshot(
      (snap) => onChange(snap.docChanges().map((change) => ({
        type: change.type,
        record: Object.assign({ id: change.doc.id }, change.doc.data())
      }))),
      (error) => onError && onError(error)
    );
  }

  window.MitaliFirebase = Object.freeze({
    config: Object.freeze({ projectId: firebaseConfig.projectId }),
    collections: Object.freeze(Object.assign({}, COLLECTIONS)),
    init,
    ready,
    getTable,
    setTable,
    getValue,
    setValue,
    upsertRecord,
    deleteRecords,
    subscribe,
    authEmailForUsername,
    signInWithUsername,
    createAuthUserForUsername,
    signOut,
    authUser,
    waitForAuth,
    getUserProfile
  });
})();
