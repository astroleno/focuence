import { el } from './ui.js';

export function trackingAction(settings) {
  return settings?.tracking ? '暂停记录' : settings?.trackingConsentGranted ? '恢复记录' : '开启记录';
}

export function trackingStatus(settings) {
  return settings?.tracking ? '本机记录中' : settings?.trackingConsentGranted ? '记录已暂停' : '记录未开启';
}

function confirmTracking() {
  const cancel = el('button', {id: 'tracking-consent-cancel', type: 'button', autofocus: true}, '暂不开启');
  const accept = el('button', {id: 'tracking-consent-accept', type: 'button'}, '同意并开始记录');
  const dialog = el('dialog', {
    id: 'tracking-consent', class: 'tracking-consent',
    'aria-labelledby': 'tracking-consent-title', 'aria-describedby': 'tracking-consent-disclosure tracking-consent-controls'
  },
  el('h2', {id: 'tracking-consent-title'}, '开启前台浏览记录？'),
  el('p', {id: 'tracking-consent-disclosure'}, '开启后，Focuence 会持续读取并在当前浏览器本机保存前台网页的网址、标题、停留时间与切换记录，用于注意力地图、找回访问线索和接续任务。'),
  el('p', {id: 'tracking-consent-controls'}, '你随时可以暂停记录，或在“数据与设置”删除记录。暂不开启也可以整理标签页和使用已保存的任务。'),
  el('div', {class: 'tracking-consent-actions'}, cancel, accept));
  document.body.append(dialog);
  return new Promise(resolve => {
    let accepted = false;
    dialog.addEventListener('close', () => { dialog.remove(); resolve(accepted); }, {once: true});
    cancel.addEventListener('click', () => dialog.close());
    accept.addEventListener('click', event => {
      if (!event.isTrusted) return;
      accepted = true;
      dialog.close();
    });
    dialog.showModal();
  });
}

export async function saveTrackingSettings(request, settings, patch) {
  if (patch.tracking !== true || settings.trackingConsentGranted) {
    try {
      return await request('UPDATE_SETTINGS', {patch});
    } catch (error) {
      if (error.code !== 'TRACKING_CONSENT_REQUIRED') throw error;
    }
  }
  return await confirmTracking() ? request('ACCEPT_TRACKING', {patch}) : null;
}
