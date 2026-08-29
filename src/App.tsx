import { useEffect } from 'react'

export default function App() {
  useEffect(() => {
    // The vanilla app code in index.html's <script id="solimedical-app"> runs before
    // React mounts this component, so document.getElementById("app") returns null.
    // We re-run the vanilla app initialization here after React has created the #app element.
    const app = document.getElementById('app')
    if (!app) return

    // Re-execute the vanilla app logic by dispatching a custom event
    // that the inline script can listen for
    window.dispatchEvent(new CustomEvent('soli-app-ready'))
  }, [])

  return <div id="app" aria-live="polite" />
}
