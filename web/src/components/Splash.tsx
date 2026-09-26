import { useBootHold, useBooted } from '../lib/boot'

/** Waiting for something. While the app boots this just holds the boot screen (so there is only ever one
 *  loader); after that it's a quiet placeholder whose dots only appear if the wait is noticeable. */
export function Splash() {
  useBootHold(true)
  const booted = useBooted()
  return (
    <div className="splash" aria-label="Loading">
      {booted && <span className="splash-dots" aria-hidden="true"><i /><i /><i /><i /></span>}
    </div>
  )
}
