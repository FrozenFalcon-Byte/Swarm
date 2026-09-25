import { Link } from 'react-router-dom'
import { Logo } from './Logo'
import { missingConfig } from '../lib/firebase'
import { Roll } from './Roll'

/** Shown instead of sign-in and the dashboard when the Firebase web config is incomplete. */
export function SetupNeeded() {
  return (
    <div className="setup">
      <Logo to="/" />
      <div className="setup-card">
        <p className="surtitle"><span style={{ background: 'var(--triager)' }} />Almost there</p>
        <h1>Connect a Firebase project</h1>
        <p>Sign-in and the dashboard need your project’s web config. Add these to <code>web/.env.local</code>, then restart the dev server (or rebuild before deploying):</p>
        <ul>{missingConfig.map((k) => <li key={k}><code>{k}</code></li>)}</ul>
        <p>Find them in the Firebase console → Project settings → General → Your apps → Web app. To try Swarm without a project, set <code>VITE_USE_EMULATORS=true</code> and run the local emulators. <code>SETUP.md</code> walks through both.</p>
        <Link className="btn btn-dark" to="/"><Roll>Back to the home page</Roll></Link>
      </div>
    </div>
  )
}
