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
    labExpenses: "lab_expenses"
  };

  let app = null;
  let db = null;
  let auth = null;
  let persistencePromise = null;

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

  async function getTable(key) {
    await ready();
    const snap = await db.collection(collectionName(key)).get();
    return snap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data()));
  }

  async function setTable(key, records) {
    await ready();
    if (!Array.isArray(records)) throw new Error(`Firestore table must be an array: ${key}`);
    const collection = db.collection(collectionName(key));
    const existing = await collection.get();
    const nextIds = new Set(records.map((record) => String(record.id)));
    const batch = db.batch();

    // Replace the collection atomically from the application's point of view.
    // Deletions are included so records deleted in the app do not return later.
    existing.docs.forEach((doc) => {
      if (!nextIds.has(doc.id)) batch.delete(doc.ref);
    });
    records.forEach((record) => {
      if (!record || !record.id) throw new Error(`Firestore record has no id: ${key}`);
      const data = cleanDocument(Object.assign({}, record));
      delete data.id;
      batch.set(collection.doc(String(record.id)), data, { merge: false });
    });
    await batch.commit();
    return records;
  }

  async function upsertRecord(key, record) {
    await ready();
    if (!record || !record.id) throw new Error(`Firestore record has no id: ${key}`);
    const data = cleanDocument(Object.assign({}, record));
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
    upsertRecord,
    deleteRecords,
    subscribe,
    authEmailForUsername,
    signInWithUsername,
    createAuthUserForUsername,
    signOut,
    authUser
  });
})();
