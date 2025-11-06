
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
const saved = localStorage.getItem('preditor-theme') || 'light'
document.documentElement.setAttribute('data-theme', saved)
createRoot(document.getElementById('root')).render(<App />)
