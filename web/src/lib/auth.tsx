import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  EmailAuthProvider, GithubAuthProvider, GoogleAuthProvider, createUserWithEmailAndPassword, deleteUser, getRedirectResult, linkWithCredential,
  linkWithPopup, linkWithRedirect, onAuthStateChanged, reauthenticateWithCredential, reauthenticateWithPopup, reauthenticateWithRedirect,
  sendPasswordResetEmail, signInWithCustomToken, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, unlink,
  updatePassword, updateProfile, verifyBeforeUpdateEmail, type AuthProvider as Provider, type User, type UserCredential,
} from 'firebase/auth'
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore'
import { api, createPasskey, deviceLabel, getPasskey } from './api'
import { auth, db, installed } from './firebase'
import { whoAmI } from './github'

export type PasskeyStep = 'prepare' | 'device' | 'verify' | 'done'

interface AuthCtx {
  user: User | null
  loading: boolean
  /** A Google or GitHub redirect that came back with an error (the installed app signs in by redirect). */
  redirectError: unknown
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
  /** `onStep` hears each stage, so the page can animate it: asking the server, the device prompt, checking, done. */
  withPasskey(onStep?: (s: PasskeyStep) => void): Promise<void>
  addPasskey(name?: string, onStep?: (s: PasskeyStep) => void): Promise<void>
  /** Confirm it's really you before a sensitive change: your password, or your provider's popup. */
  reauthenticate(password?: string): Promise<void>
  updateName(name: string): Promise<void>
  changeEmail(email: string): Promise<void>
  /** Change the password, or add one to an account that signs in with Google or GitHub only. */
  setPassword(next: string): Promise<void>
  linkProvider(id: 'google.com' | 'github.com'): Promise<void>
  unlinkProvider(id: string): Promise<void>
  deleteAccount(): Promise<void>
  /** Bumped after changes Firebase doesn't announce (names, linked providers), so the UI re-reads the user. */
  version: number
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

/** Google or GitHub: a pop-up in the browser. Installed on the home screen, pop-ups never report back, so
 *  the whole app goes to the provider and comes back instead; getRedirectResult picks it up on return. */
async function viaProvider(flow: 'signin' | 'link' | 'reauth', provider: Provider, user?: User): Promise<UserCredential> {
  if (!installed) {
    if (flow === 'signin') return signInWithPopup(auth, provider)
    return flow === 'link' ? linkWithPopup(user!, provider) : reauthenticateWithPopup(user!, provider)
  }
  if (flow === 'signin') await signInWithRedirect(auth, provider)
  else if (flow === 'link') await linkWithRedirect(user!, provider)
  else await reauthenticateWithRedirect(user!, provider)
  return new Promise<never>(() => {}) // the page is on its way to the provider
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const bump = async () => { await auth.currentUser?.reload(); setUser(auth.currentUser); setVersion((v) => v + 1) }
  const need = () => { if (!auth.currentUser) throw new Error('Sign in first.'); return auth.currentUser }

  const [redirectError, setRedirectError] = useState<unknown>(null)
  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false) }), [])
  // back from a Google or GitHub redirect (the installed app): finish what the pop-up would have
  useEffect(() => {
    if (!installed) return
    getRedirectResult(auth).then(async (result) => {
      if (!result) return
      await saveProfile(result.user)
      if (result.providerId === 'github.com') await fromOAuth(result)
      await bump()
    }).catch(setRedirectError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value: AuthCtx = {
    user, loading, redirectError,
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
      const { user } = await viaProvider('signin', new GoogleAuthProvider())
      await saveProfile(user)
    },
    async withGitHub() {
      const result = await viaProvider('signin', githubProvider())
      await saveProfile(result.user)
      await fromOAuth(result)
    },
    async connectGitHub() {
      const current = auth.currentUser
      if (!current) throw new Error('Sign in first.')
      const linked = current.providerData.some((p) => p.providerId === 'github.com')
      // Already linked: re-authenticate to get a fresh token. Otherwise attach GitHub to this account.
      const result = await viaProvider(linked ? 'reauth' : 'link', githubProvider(), current)
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
    version,
    async withPasskey(onStep) {
      onStep?.('prepare')
      const { challengeId, options } = await api<{ challengeId: string; options: Record<string, unknown> }>('/api/passkeys/login/options')
      onStep?.('device')
      const credential = await getPasskey(options)
      onStep?.('verify')
      const { token } = await api<{ token: string }>('/api/passkeys/login/verify', { challengeId, credential })
      const { user } = await signInWithCustomToken(auth, token)
      await saveProfile(user)
      onStep?.('done')
    },
    async addPasskey(name, onStep) {
      const u = need()
      onStep?.('prepare')
      const idToken = await u.getIdToken()
      const { challengeId, options } = await api<{ challengeId: string; options: Record<string, unknown> }>('/api/passkeys/register/options', {}, idToken)
      onStep?.('device')
      const credential = await createPasskey(options)
      onStep?.('verify')
      await api('/api/passkeys/register/verify', { challengeId, credential, name: name || deviceLabel() }, idToken)
      onStep?.('done')
    },
    async reauthenticate(password) {
      const u = need()
      if (password && u.email) { await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password)); return }
      const via = u.providerData.find((p) => p.providerId === 'google.com') ? new GoogleAuthProvider()
        : u.providerData.find((p) => p.providerId === 'github.com') ? githubProvider() : null
      if (!via) throw Object.assign(new Error('Enter your password to confirm.'), { code: 'swarm/password-needed' })
      await viaProvider('reauth', via, u)
    },
    async updateName(name) {
      const u = need()
      await updateProfile(u, { displayName: name })
      await setDoc(doc(db, 'users', u.uid), { displayName: name }, { merge: true })
      await bump()
    },
    async changeEmail(email) {
      // Firebase sends a link to the new address; the change applies once it's clicked
      await verifyBeforeUpdateEmail(need(), email)
    },
    async setPassword(next) {
      const u = need()
      if (u.providerData.some((p) => p.providerId === 'password')) await updatePassword(u, next)
      else if (u.email) await linkWithCredential(u, EmailAuthProvider.credential(u.email, next))
      else throw new Error('Add an email address first.')
      await bump()
    },
    async linkProvider(id) {
      const u = need()
      const result = await viaProvider('link', id === 'github.com' ? githubProvider() : new GoogleAuthProvider(), u)
      if (id === 'github.com') await fromOAuth(result)
      await bump()
    },
    async unlinkProvider(id) {
      const u = need()
      if (u.providerData.length <= 1) throw new Error('Keep at least one way to sign in.')
      await unlink(u, id)
      if (id === 'github.com') {
        await deleteDoc(doc(db, 'users', u.uid, 'private', 'github')).catch(() => {})
        await setDoc(doc(db, 'users', u.uid), { githubConnected: false, githubLogin: null }, { merge: true })
      }
      await bump()
    },
    async deleteAccount() {
      const u = need()
      // everything that's yours first; the account last, since deleting it ends access to the rest
      const batch = writeBatch(db)
      for (const [col, field] of [['repos', 'ownerUid'], ['mcpTokens', 'uid'], ['passkeys', 'uid']] as const) {
        const snap = await getDocs(query(collection(db, col), where(field, '==', u.uid)))
        snap.forEach((d) => batch.delete(d.ref))
      }
      batch.delete(doc(db, 'users', u.uid, 'private', 'github'))
      batch.delete(doc(db, 'users', u.uid))
      await batch.commit()
      await deleteUser(u)
    },
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
    'auth/requires-recent-login': 'For your security, confirm it’s you first.',
    'auth/provider-already-linked': 'That sign-in method is already connected.',
    'auth/no-such-provider': 'That sign-in method isn’t connected.',
    'auth/email-change-needs-verification': 'Check your inbox to confirm the new address.',
    'auth/operation-not-allowed-email': 'Email changes aren’t enabled for this project.',
    'auth/invalid-custom-token': 'The passkey sign-in expired. Try again.',
    'swarm/password-needed': 'Enter your password to confirm.',
  }
  if (map[code]) return map[code]
  const msg = (e as Error)?.message
  return msg && !code ? msg : 'Something went wrong. Try again.'
}
