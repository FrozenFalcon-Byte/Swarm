import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

const env = import.meta.env
export const usingEmulators = env.VITE_USE_EMULATORS === 'true'
const projectId = env.VITE_FIREBASE_PROJECT_ID || 'demo-swarm'

/** Web config values that are missing when pointing at a real project; empty means ready. */
export const missingConfig: string[] = usingEmulators ? [] : (
  ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']
    .filter((k) => !env[k] || (k === 'VITE_FIREBASE_PROJECT_ID' && env[k] === 'demo-swarm'))
)

export const firebaseInfo = { projectId, usingEmulators }

export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY || 'demo-key',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  projectId,
  // must match the worker's bucket (swarm/cloud/firebase.py): new projects use .firebasestorage.app
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
  appId: env.VITE_FIREBASE_APP_ID || 'demo-app',
})

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)

if (usingEmulators) {
  const host = window.location.hostname
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
  connectStorageEmulator(storage, host, 9199)
}
