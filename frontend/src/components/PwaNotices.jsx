import { useEffect, useState } from 'react';
import { APP_NAME } from '../brand.js';
import { isStandalone, needsIosInstallHint } from '../utils/install.js';
// Kept beside the component (not in styles.css) so the installed-app
// pieces stay in one place.
import './PwaNotices.css';

const DISMISSED_KEY = 'finance_install_dismissed';

// Storage can throw (Safari private mode, blocked site data); the prompt
// then just shows again next visit, which is harmless.
function wasDismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
}
function rememberDismissed() {
  try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* see above */ }
}

function ShareIcon() {
  // The iOS Share glyph: a box with an arrow leaving it.
  return (
    <svg className="pwa-share-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5v8M5 4.5l3-3 3 3M4.5 7H3.5v7h9V7h-1" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InstallPrompt({ suppressed }) {
  // Chrome/Edge/Samsung hand us this event instead of their own mini
  // banner; calling .prompt() on it later shows the browser's install dialog.
  const [installEvent, setInstallEvent] = useState(null);
  const [hidden, setHidden] = useState(() => wasDismissed() || isStandalone(window));
  const [iosHint] = useState(() => needsIosInstallHint(navigator));

  useEffect(() => {
    function onBeforeInstall(e) {
      e.preventDefault();
      setInstallEvent(e);
    }
    function onInstalled() {
      setInstallEvent(null);
      setHidden(true);
      rememberDismissed();
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    setHidden(true);
    rememberDismissed();
  }

  async function install() {
    const event = installEvent;
    setInstallEvent(null); // the event can only be used once
    event.prompt();
    // Either answer settles it: accepted means installed, and turning down
    // the browser's own dialog counts as "not now".
    await event.userChoice;
    dismiss();
  }

  if (suppressed || hidden || (!installEvent && !iosHint)) return null;

  return (
    <aside className="pwa-install" aria-label={`Install ${APP_NAME}`}>
      <span className="pwa-install-mark" aria-hidden="true" />
      <div className="pwa-install-text">
        <strong>{installEvent ? `Install ${APP_NAME}` : `Add ${APP_NAME} to your Home Screen`}</strong>
        {installEvent ? (
          <span>Opens like an app, ready to scan a receipt or check Safe to spend.</span>
        ) : (
          <span>Tap <ShareIcon /> Share, then <b>Add to Home Screen</b>.</span>
        )}
      </div>
      <div className="pwa-install-actions">
        {installEvent && <button type="button" className="btn btn-primary btn-sm" onClick={install}>Install</button>}
        <button type="button" className="btn btn-secondary btn-sm" onClick={dismiss}>
          {installEvent ? 'Not now' : 'Got it'}
        </button>
      </div>
    </aside>
  );
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export default function PwaNotices() {
  const online = useOnline();
  return (
    <>
      {/* The app shell opens offline, but money figures are never cached
          (see vite.config.js), so say why the numbers won't load rather
          than letting every card show its own error. */}
      {!online && (
        <div className="pwa-offline" role="status">
          You're offline. Balances and transactions are never stored on this device, so they'll load once you reconnect.
        </div>
      )}
      {/* Stays mounted while offline so a stashed install event survives
          a dropped connection; it just steps aside for the notice. */}
      <InstallPrompt suppressed={!online} />
    </>
  );
}
