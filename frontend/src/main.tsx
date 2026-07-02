import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { queryClient } from './api/queryClient'
import './index.css'
// color-templates: index.css 토큰을 덮어쓰는 [data-theme] 팔레트 — 반드시 뒤에 import
import './styles/color-templates.css'

// Design-comment overlay (tools/design-commenter): opt-in only. Loads the
// visual feedback tool when the URL has ?dc=1 AND the user is logged in (JWT).
// Anonymous visitors never receive it; it ships no source paths (Selector-based).
// Usage: append ?dc=1 to any page while logged in (e.g. /?dc=1, /portfolio?dc=1).
try {
  if (new URLSearchParams(location.search).get('dc') === '1' && localStorage.getItem('token')) {
    const s = document.createElement('script')
    s.src = '/design-commenter.js'
    s.defer = true
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(s))
    if (document.readyState !== 'loading') document.body.appendChild(s)
  }
} catch {
  /* ignore */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
