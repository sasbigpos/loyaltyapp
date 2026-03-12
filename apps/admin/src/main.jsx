import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { installFirebaseStorage } from './firebase.js'

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────
// If running inside the Claude artifact sandbox, window.storage is already
// provided natively — skip Firebase init.
//
// Outside Claude (local dev, GitHub Pages, Vercel, etc.), install the
// Firestore-backed adapter. All reads/writes in App.jsx go through the
// same window.storage API so nothing else needs to change.

if (!window.storage) {
  installFirebaseStorage()
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
