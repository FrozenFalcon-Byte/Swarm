import { AnimatePresence, MotionConfig, useIsPresent } from 'motion/react'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { PageTransition, routeLabel } from './components/PageTransition'
import { SetupNeeded } from './components/SetupNeeded'
import { Splash } from './components/Splash'
import { useAuth } from './lib/auth'
import { bootReady } from './lib/boot'
import { useProfile } from './lib/data'
import { missingConfig } from './lib/firebase'
import Landing from './pages/landing/Landing'

const loadAuth = () => import('./pages/auth/AuthPage')
const loadShell = () => import('./pages/app/AppShell')
const loadDocs = () => import('./pages/docs/McpDocs')
const loadOnboarding = () => import('./pages/onboarding/Onboarding')
const loadPlayground = () => import('./pages/site/Playground')
const loadCost = () => import('./pages/site/Cost')
const AuthPage = lazy(loadAuth)
const AppShell = lazy(loadShell)
const McpDocs = lazy(loadDocs)
const Onboarding = lazy(loadOnboarding)
const Playground = lazy(loadPlayground)
const Cost = lazy(loadCost)

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  // a page that is already animating away must not redirect (that is how signing out used to land on /signin)
  const present = useIsPresent()
  if (loading) return <Splash />
  if (!user) return present ? <Navigate to="/signin" replace state={{ from: location.pathname }} /> : <>{children}</>
  return <>{children}</>
}

/** The dashboard opens only once first-time setup is finished; until then every visit resumes it. */
function RequireOnboarded({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const profile = useProfile(user?.uid)
  const present = useIsPresent()
  if (profile === undefined) return <Splash />
  if (!profile?.onboardedAt) return present ? <Navigate to="/onboarding" replace /> : <>{children}</>
  return <>{children}</>
}

/** Sign-in and the dashboard need a Firebase project; the landing page doesn't. */
function NeedsFirebase({ children }: { children: ReactNode }) {
  return missingConfig.length ? <SetupNeeded /> : <>{children}</>
}

export default function App() {
  const location = useLocation()
  const { user } = useAuth()
  const motionPref = useProfile(user?.uid)?.prefs?.motion ?? 'system'
  // CSS animations follow the same setting as motion's (see .less-motion in index.css)
  useEffect(() => { document.documentElement.classList.toggle('less-motion', motionPref === 'less') }, [motionPref])
  // top-level section: landing, auth, or the app (the app runs its own pane transitions)
  const section = location.pathname.startsWith('/app') ? 'app' : location.pathname
  // warm the other sections' code so a page change never lands on a loading screen
  useEffect(() => { const id = window.setTimeout(() => { loadAuth(); loadShell(); loadDocs(); loadOnboarding(); loadPlayground(); loadCost() }, 1500); return () => window.clearTimeout(id) }, [])
  useEffect(() => { bootReady() }, [])
  const label = routeLabel(section === 'app' ? '/app' : section)

  return (
    // scroll to the top only once the old page has folded away, never while it's still on screen
    <MotionConfig reducedMotion={motionPref === 'less' ? 'always' : motionPref === 'full' ? 'never' : 'user'}>
    <AnimatePresence mode="wait" initial={false} onExitComplete={() => { if (!window.location.hash) window.scrollTo(0, 0) }}>
      <PageTransition key={section} label={label}>
        <Suspense fallback={<Splash />}>
          <Routes location={location}>
            <Route path="/" element={<Landing />} />
            <Route path="/docs/mcp" element={<McpDocs />} />
            <Route path="/playground" element={<Playground />} />
            <Route path="/cost" element={<Cost />} />
            <Route path="/signin" element={<NeedsFirebase><AuthPage mode="signin" /></NeedsFirebase>} />
            <Route path="/signup" element={<NeedsFirebase><AuthPage mode="signup" /></NeedsFirebase>} />
            <Route path="/onboarding" element={<NeedsFirebase><RequireAuth><Onboarding /></RequireAuth></NeedsFirebase>} />
            <Route path="/app/*" element={<NeedsFirebase><RequireAuth><RequireOnboarded><AppShell /></RequireOnboarded></RequireAuth></NeedsFirebase>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </PageTransition>
    </AnimatePresence>
    </MotionConfig>
  )
}
