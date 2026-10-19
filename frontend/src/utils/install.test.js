import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIos, isStandalone, needsIosInstallHint } from './install.js';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

test('iPhone Safari gets the Add to Home Screen hint', () => {
  assert.equal(needsIosInstallHint({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5 }), true);
});

test('Chrome on iPhone does not (it has no reliable Add to Home Screen)', () => {
  assert.equal(needsIosInstallHint({ userAgent: IPHONE_CHROME, maxTouchPoints: 5 }), false);
});

test('an iPad that reports itself as a Mac is still iOS', () => {
  assert.equal(isIos({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 5 }), true);
  assert.equal(isIos({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 0 }), false); // a real Mac
});

test('Android Chrome uses beforeinstallprompt, not the iOS hint', () => {
  assert.equal(needsIosInstallHint({ userAgent: ANDROID_CHROME, maxTouchPoints: 5 }), false);
});

test('standalone covers both the display-mode query and iOS navigator.standalone', () => {
  const mm = (matches) => () => ({ matches });
  assert.equal(isStandalone({ matchMedia: mm(true), navigator: {} }), true);
  assert.equal(isStandalone({ matchMedia: mm(false), navigator: { standalone: true } }), true);
  assert.equal(isStandalone({ matchMedia: mm(false), navigator: {} }), false);
});
