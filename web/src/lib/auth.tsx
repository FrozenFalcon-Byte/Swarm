import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  GithubAuthProvider, GoogleAuthProvider, createUserWithEmailAndPassword, linkWithPopup, onAuthStateChanged,
  reauthenticateWithPopup, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, unlink,
  updateProfile, type User, type UserCredential,
} from 'firebase/auth'
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { whoAmI } from './github'

interface AuthCtx {
  user: User | null
  loading: boolean
  signIn(email: string, password: string): Promise<void>
  signUp(name: string, email: string, password: string): Promise<void>
  withGoogle(): Promise<void>
  withGitHub(): Promise<void>
  /** Link GitHub to the current account (any sign-in method) and save a repo-scoped token. */
  connectGitHub(): Promise<void>
  /** Save a personal access token instead of OAuth, after checking it with GitHub. */
  saveGithubToken(token: string): Promise<string>
  disconnectGitHub(): Promise<void>
  resetPassword(email: string): Promise<void>
  logOut(): Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

async function saveProfile(user: User, extra: Record<string, unknown> = {}) {
  await setDoc(doc(db, 'users', user.uid), {
    displayName: user.displayName || user.email?.split('@')[0] || 'You',
    email: user.email, photoURL: user.photoURL, lastLoginAt: serverTimestamp(), ...extra,
  }, { merge: true })
}

function githubProvider() {
  // repo scope lets the worker read issues on private repos and open pull requests.
  const provider = new GithubAuthProvider()
  provider.addScope('repo')
  return provider
}

async function saveGithubLink(uid: string, token: string, source: 'oauth' | 'pat') {
  const { user, scopes } = await whoAmI(token)
  await setDoc(doc(db, 'users', uid, 'private', 'github'), {
    token, source, scopes, login: user.login, avatarUrl: user.avatar_url, savedAt: serverTimestamp(),
  })
  await setDoc(doc(db, 'users', uid), { githubConnected: true, githubLogin: user.login }, { merge: true })
  return user.login
}

async function fromOAuth(result: UserCredential) {
  const token = GithubAuthProvider.credentialFromResult(result)?.accessToken
  if (token) await saveGithubLink(result.user.uid, token, 'oauth')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false) }), [])

  const value: AuthCtx = {
    user, loading,
    async signIn(email, password) {
      const { user } = await signInWithEmailAndPassword(auth, email, password)
      await saveProfile(user)
    },
    async signUp(name, email, password) {
      const { user } = await createUserWithEmailAndPassword(auth, email, password)
      await updateProfile(user, { displayName: name })
      await saveProfile(user, { displayName: name, createdAt: serverTimestamp() })
    },
    async withGoogle() {
      const { user } = await signInWithPopup(auth, new GoogleAuthProvider())
      await saveProfile(user)
    },
    async withGitHub() {
      const result = await signInWithPopup(auth, githubProvider())
      await saveProfile(result.user)
      await fromOAuth(result)
    },
    async connectGitHub() {
      const current = auth.currentUser
      if (!current) throw new Error('Sign in first.')
      const linked = current.providerData.some((p) => p.providerId === 'github.com')
      // Already linked: re-authenticate to get a fresh token. Otherwise attach GitHub to this account.
      const result = linked ? await reauthenticateWithPopup(current, githubProvider()) : await linkWithPopup(current, githubProvider())
      await fromOAuth(result)
    },
    async saveGithubToken(token) {
      const current = auth.currentUser
      if (!current) throw new Error('Sign in first.')
      return saveGithubLink(current.uid, token.trim(), 'pat')
    },
    async disconnectGitHub() {
      const current = auth.currentUser
      if (!current) return
      await deleteDoc(doc(db, 'users', current.uid, 'private', 'github'))
      await setDoc(doc(db, 'users', current.uid), { githubConnected: false, githubLogin: null }, { merge: true })
      // keep GitHub as a sign-in method only if it's the account's only one
      if (current.providerData.length > 1 && current.providerData.some((p) => p.providerId === 'github.com')) {
        await unlink(current, 'github.com')
      }
    },
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    logOut: () => signOut(auth),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

export function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code || ''
  const map: Record<string, string> = {
    'auth/invalid-credential': 'That email and password don’t match an account.',
    'auth/wrong-password': 'That email and password don’t match an account.',
    'auth/user-not-found': 'No account uses that email yet. Create one instead.',
    'auth/email-already-in-use': 'An account already uses that email. Sign in instead.',
    'auth/weak-password': 'Use at least 6 characters for your password.',
    'auth/invalid-email': 'That doesn’t look like an email address.',
    'auth/popup-closed-by-user': 'The sign-in window was closed before finishing.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/operation-not-allowed': 'This sign-in method isn’t enabled for the project yet.',
    'auth/credential-already-in-use': 'That GitHub account already belongs to another Swarm account. Sign in with GitHub instead.',
    'auth/account-exists-with-different-credential': 'An account with this email already exists. Sign in the way you did before, then connect GitHub in Settings.',
    'auth/popup-blocked': 'The browser blocked the sign-in window. Allow pop-ups for this site and try again.',
    'auth/unauthorized-domain': 'This domain isn’t allowed to sign in yet. Add it under Firebase Authentication → Settings → Authorized domains.',
    'auth/configuration-not-found': 'Authentication isn’t set up for this Firebase project yet.',
  }
  return map[code] || 'Something went wrong signing you in. Try again.'
}
