/** Swarm's own server (`swarm hub` or `swarm server`): passkeys and MCP. Everything else talks to Firebase directly. */

export const API_URL = (import.meta.env.VITE_SWARM_API_URL || 'http://localhost:8787').replace(/\/$/, '')
export const MCP_URL = `${API_URL}/mcp`

export class ApiError extends Error {}

let lastWake = 0
/** Nudge the hub awake (free hosts sleep when idle). It watches Firestore, so once it's up it sees whatever you
 *  just queued and starts the worker straight away. Fire and forget, at most once every 30 seconds. */
export function wakeHub() {
  if (!import.meta.env.VITE_SWARM_API_URL || Date.now() - lastWake < 30_000) return
  lastWake = Date.now()
  fetch(`${API_URL}/healthz`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {})
}

export async function api<T>(path: string, body: unknown = {}, idToken?: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError(`Swarm’s server isn’t reachable at ${API_URL}. Start it with: swarm hub`)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error || `The server answered ${res.status}.`)
  return data as T
}

/* ---- WebAuthn plumbing: the server speaks JSON with base64url bytes, the browser wants ArrayBuffers */

const b64urlToBuf = (s: string) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer
}
const bufToB64url = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const passkeysSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function createPasskey(options: Json): Promise<Json> {
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    user: { ...options.user, id: b64urlToBuf(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c: Json) => ({ ...c, id: b64urlToBuf(c.id) })),
  } as PublicKeyCredentialCreationOptions
  const cred = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null
  if (!cred) throw new ApiError('No passkey was created.')
  const r = cred.response as AuthenticatorAttestationResponse
  return {
    id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type,
    response: { clientDataJSON: bufToB64url(r.clientDataJSON), attestationObject: bufToB64url(r.attestationObject), transports: r.getTransports?.() || [] },
    clientExtensionResults: cred.getClientExtensionResults(), authenticatorAttachment: cred.authenticatorAttachment,
  }
}

export async function getPasskey(options: Json): Promise<Json> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c: Json) => ({ ...c, id: b64urlToBuf(c.id) })),
  } as PublicKeyCredentialRequestOptions
  const cred = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null
  if (!cred) throw new ApiError('No passkey was chosen.')
  const r = cred.response as AuthenticatorAssertionResponse
  return {
    id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: bufToB64url(r.clientDataJSON), authenticatorData: bufToB64url(r.authenticatorData),
      signature: bufToB64url(r.signature), userHandle: r.userHandle ? bufToB64url(r.userHandle) : null,
    },
    clientExtensionResults: cred.getClientExtensionResults(), authenticatorAttachment: cred.authenticatorAttachment,
  }
}

/** A friendly name for a new passkey, from the browser and OS. */
export function deviceLabel() {
  const ua = navigator.userAgent
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : 'this device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ''
  return browser ? `${browser} on ${os}` : os
}

export function webauthnError(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError') return 'The passkey prompt was closed or timed out.'
  if (name === 'InvalidStateError') return 'This device already has a passkey for your account.'
  if (name === 'SecurityError') return 'Passkeys need a secure address (https, or localhost).'
  return (e as Error)?.message || 'The passkey didn’t work. Try again.'
}
