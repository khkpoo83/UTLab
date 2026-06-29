import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
// color-templates: index.css 토큰을 덮어쓰는 [data-theme] 팔레트 — 반드시 뒤에 import
import './styles/color-templates.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
