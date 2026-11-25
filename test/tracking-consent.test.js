import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeBackup} from '../src/backup.js';
import * as store from '../src/store.js';
import {saveTrackingSettings, trackingAction, trackingStatus} from '../src/tracking-consent-ui.js';

test('recording defaults off and backup settings never carry local consent', () => {
  assert.equal(store.DEFAULT_SETTINGS.tracking, false);
  const backup = decodeBackup({
    schemaVersion: 6, pages: [], tasks: [], segments: [], taskRelations: [], libraryItems: [],
    settings: {tracking: true, trackingConsentGranted: true, foregroundTrackingConsent: 1}
  }, store);
  assert.equal(backup.settings.tracking, true);
  assert.equal(Object.hasOwn(backup.settings, 'trackingConsentGranted'), false);
  assert.equal(Object.hasOwn(backup.settings, 'foregroundTrackingConsent'), false);
});

test('first-time and previously consented recording show distinct states', () => {
  assert.equal(trackingAction({tracking: false}), '开启记录');
  assert.equal(trackingStatus({tracking: false}), '记录未开启');
  assert.equal(trackingAction({trackingConsentGranted: true, tracking: false}), '恢复记录');
  assert.equal(trackingStatus({trackingConsentGranted: true, tracking: false}), '记录已暂停');
  assert.equal(trackingAction({trackingConsentGranted: true, tracking: true}), '暂停记录');
});

test('ordinary settings and previously consented resuming use the regular settings RPC', async () => {
  const calls = [];
  const request = async (type, payload) => { calls.push([type, payload]); return payload.patch; };
  assert.deepEqual(await saveTrackingSettings(request, {trackingConsentGranted: false}, {semantic: false}), {semantic: false});
  assert.deepEqual(await saveTrackingSettings(request, {trackingConsentGranted: true}, {tracking: true}), {tracking: true});
  assert.deepEqual(calls, [
    ['UPDATE_SETTINGS', {patch: {semantic: false}}],
    ['UPDATE_SETTINGS', {patch: {tracking: true}}]
  ]);
});
