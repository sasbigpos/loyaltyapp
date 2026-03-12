/**
 * LOYALCORE — Firebase Storage Adapter (Admin)
 *
 * Replaces window.storage with a Firestore-backed implementation that gives
 * true cross-device real-time sync between the Admin and Member portals.
 *
 * All keys are stored in the Firestore collection "loyalcore" as documents
 * whose IDs are the storage keys (with ":" replaced by "__" since Firestore
 * document IDs cannot contain forward slashes or colons).
 *
 * Document shape:  { value: "<JSON string>", updatedAt: Timestamp }
 */

import { initializeApp, getApps } from 'firebase/app'
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore'

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Values are read from environment variables (set in .env.local or GitHub Secrets).
// See FIREBASE_SETUP.md for how to get these values.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

// ─── INIT ────────────────────────────────────────────────────────────────────
// Guard against double-init (e.g. HMR in dev)
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
const db  = getFirestore(app)

const COLLECTION = 'loyalcore'

/** Firestore document IDs cannot contain ':' — swap to '__' */
const toDocId = (key) => key.replace(/:/g, '__')
const fromDocId = (id) => id.replace(/__/g, ':')

// ─── ADAPTER ────────────────────────────────────────────────────────────────
/**
 * Installs window.storage backed by Firestore.
 * Called once from main.jsx before React renders.
 */
export function installFirebaseStorage() {
  window.storage = {
    /**
     * Get a value by key.
     * Throws (like the native Claude API) if the key does not exist.
     */
    async get(key, _shared = true) {
      const ref  = doc(db, COLLECTION, toDocId(key))
      const snap = await getDoc(ref)
      if (!snap.exists()) throw new Error(`Key not found: ${key}`)
      return { key, value: snap.data().value }
    },

    /**
     * Set a value. Creates or overwrites.
     */
    async set(key, value, _shared = true) {
      const ref = doc(db, COLLECTION, toDocId(key))
      await setDoc(ref, { value, updatedAt: serverTimestamp() })
      return { key, value }
    },

    /**
     * Delete a key.
     */
    async delete(key, _shared = true) {
      const ref = doc(db, COLLECTION, toDocId(key))
      await deleteDoc(ref)
      return { key, deleted: true }
    },

    /**
     * List all keys, optionally filtered by prefix.
     */
    async list(prefix = '', _shared = true) {
      const col  = collection(db, COLLECTION)
      const snap = await getDocs(col)
      const keys = snap.docs
        .map(d => fromDocId(d.id))
        .filter(k => k.startsWith(prefix))
      return { keys }
    },
  }

  console.info('[LOYALCORE] Firebase storage adapter installed.')
}

/**
 * Subscribe to real-time changes on a Firestore document.
 * Returns an unsubscribe function.
 *
 * Usage:
 *   const unsub = subscribeToKey('lc:members', (value) => setMembers(JSON.parse(value)))
 */
export function subscribeToKey(key, callback) {
  const ref = doc(db, COLLECTION, toDocId(key))
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) callback(snap.data().value)
  })
}

export { db }
