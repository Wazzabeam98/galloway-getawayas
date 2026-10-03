// The zoom lock goes to iPhones and nobody else.
//
// iOS Safari zooms the page when a text field is tapped; maximum-scale=1 +
// user-scalable=no stops it, and iOS still lets people pinch. Android obeys
// those two settings fully, so sending them there would take pinch-zoom away
// from every Android visitor — which is the thing these tests guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewportFor, isIOS } from '../lib/viewport';

const UA = {
    iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
    ipadMobile: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const LOCKED = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };
const PLAIN = { width: 'device-width', initialScale: 1 };

test('iPhone browsers get the zoom lock — Safari and Chrome on iOS alike', () => {
    assert.deepEqual(viewportFor(UA.iphoneSafari), LOCKED);
    assert.deepEqual(viewportFor(UA.iphoneChrome), LOCKED);
    assert.deepEqual(viewportFor(UA.ipadMobile), LOCKED);
});

test('Android keeps pinch-zoom: no maximum-scale, no user-scalable', () => {
    for (const ua of [UA.androidChrome, UA.samsung]) {
        const v = viewportFor(ua);
        assert.deepEqual(v, PLAIN);
        assert.equal('maximumScale' in v, false);
        assert.equal('userScalable' in v, false);
    }
});

test('desktops, and a missing user agent, get the plain viewport', () => {
    assert.deepEqual(viewportFor(UA.macSafari), PLAIN);
    assert.deepEqual(viewportFor(UA.windowsChrome), PLAIN);
    assert.deepEqual(viewportFor(''), PLAIN);
    assert.deepEqual(viewportFor(null), PLAIN);
    assert.equal(isIOS(undefined), false);
});
