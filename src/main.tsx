import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import KeyGate from './ui/KeyGate.tsx'
import { BACKEND, forgetKeys, hasDirectKey } from './config'
import { captureGoogleReturn, disconnectGoogle } from './lib/google'

// Back from Google's sign-in page (or given a client ID): take the token.
captureGoogleReturn()

// `?forget-keys` wipes the keys the key gate saved on this device, and signs
// out of Google here too.
if (new URLSearchParams(location.search).has('forget-keys')) {
  forgetKeys()
  disconnectGoogle()
  location.replace(location.pathname)
}

// Direct mode with no key yet (the public phone build): ask for one first.
const needsKey = BACKEND === 'direct' && !hasDirectKey()

// Deliberately no StrictMode: its double-invoked effects would open the
// microphone and arm the wake-word engine twice, and the second subscription
// steals the audio stream from the first.
createRoot(document.getElementById('root')!).render(needsKey ? <KeyGate /> : <App />)
