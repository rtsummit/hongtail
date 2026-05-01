import './assets/main.css'
// i18n init — App 보다 먼저 import 해서 useTranslation 이 즉시 작동하도록.
import './locale'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installWebApi } from './webShim'

// Electron preload 가 window.api 를 이미 채워둔 환경에서는 no-op.
// 브라우저에서 로드된 경우 fetch + EventSource 기반 shim 으로 채움.
installWebApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
