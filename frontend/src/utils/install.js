// Which "install this app" help a browser needs. Chrome, Edge and Samsung
// Internet fire `beforeinstallprompt`, so they get a real Install button.
// iOS never does: there the only route is Safari's Share > Add to Home
// Screen, so iPhone and iPad users get a short written hint instead.

// Already opened from the home screen / as an installed app.
export function isStandalone(win) {
  return Boolean(win.matchMedia?.('(display-mode: standalone)').matches || win.navigator?.standalone);
}

// iPadOS reports itself as a Mac, so a Mac with a touch screen is an iPad.
export function isIos({ userAgent = '', maxTouchPoints = 0 } = {}) {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

// Only Safari shows "Add to Home Screen" reliably on iOS; Chrome (CriOS),
// Firefox (FxiOS) and Edge (EdgiOS) on iPhone bury or lack it.
export function needsIosInstallHint(nav = {}) {
  return isIos(nav) && /Safari/.test(nav.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(nav.userAgent);
}
