import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// 開発サーバーで ?demo を付けたときだけ架空データで動かす(本番ビルドからは除去される)
if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
  const { installDemo } = await import('./dev/demo')
  installDemo()
}

// 本番だけ Service Worker を登録(ホーム画面へのインストールとオフライン起動用)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
}

createRoot(document.getElementById('root')!).render(<App />)
