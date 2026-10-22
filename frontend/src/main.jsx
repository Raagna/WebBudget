import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
// Self-hosted (no request to Google Fonts): works offline on a homelab.
import '@fontsource-variable/figtree';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Installed-app support (public/sw.js). Production builds only, so `npm run dev`
// never serves a cached page. BASE_URL keeps it working under /WebBudget/ on
// GitHub Pages and at / on any other host.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
