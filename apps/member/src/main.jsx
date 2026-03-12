import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { installFirebaseStorage } from './firebase.js'

// If running inside the Claude artifact sandbox, window.storage is already
// provided natively — skip Firebase init.
if (!window.storage) {
  installFirebaseStorage()
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
