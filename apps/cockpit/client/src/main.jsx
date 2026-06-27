import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Setup from './Setup.jsx'
import { installAuthFetch } from './lib/authFetch.js'

// Attach the local auth token to every /api request (covers the raw fetch() call
// sites that don't go through useApi). Installed before render so the first paint
// is already authenticated.
installAuthFetch()

// No React Router in this app — a single path branch is enough for the one-off
// /setup token page.
const isSetup = window.location.pathname === '/setup'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isSetup ? <Setup /> : <App />}</React.StrictMode>,
)
