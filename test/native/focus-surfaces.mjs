import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {setup, until} from './cdp.mjs';

const out = process.argv.find(value => value.startsWith('--out='))?.slice(6) || 'dist/focus-surfaces';
const env = await setup({out});
const {control, browser, extensionId, base, windowId, rpc} = env;
const report = {checks: [], errors: []};
const taskName = '工作台交互研究';
const goal = '核对键盘操作与页面切换';
const next = '验证焦点恢复并记录结果';
const pageName = '研究 · 键盘操作';
const nextSummary = '#next-prediction-summary';

async function key(page, key, code, windowsVirtualKeyCode) {
  const params = {key, code, windowsVirtualKeyCode};
  await page.send('Input.dispatchKeyEvent', {type: 'keyDown', ...params, ...(key === 'Enter' ? {text: '\r', unmodifiedText: '\r'} : {})});
  await page.send('Input.dispatchKeyEvent', {type: 'keyUp', ...params});
}

async function surfacePage(surface, width, height) {
  const page = await browser.page(`chrome-extension://${extensionId}/${surface}/index.html?windowId=${windowId}#tasks`, width, height);
  await page.send('Page.bringToFront');
  await until(() => page.eval(() => !!document.querySelector('.memory-current')), surface + ' focus ready');
  return page;
}

async function audit(page) {
  return page.eval(() => {
    const card = document.querySelector('.memory-current');
    const main = card.closest('main');
    const limit = Math.min(innerHeight, main.getBoundingClientRect().bottom);
    const actions = [...card.querySelectorAll('.memory-current-actions button')].map(node => {
      const rect = node.getBoundingClientRect();
      return {label: node.textContent, firstScreen: rect.height > 0 && rect.top >= 0 && rect.bottom <= limit};
    });
    return {
      text: card.innerText, actions,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 || main.scrollWidth > main.clientWidth + 1,
      predictionClosed: document.querySelector('#next-prediction')?.open === false,
      manage: !!document.querySelector('.memory-task-options'),
      recent: document.querySelectorAll('.popup-focus-list .recent-task').length,
      footer: !!document.querySelector('#popup-footer')?.getBoundingClientRect().height,
      activeHeading: card.querySelector('h2').textContent,
    };
  });
}

const surfaces = [
  ['app', 1280, 800], ['app', 1440, 900],
  ['panel', 320, 600], ['panel', 360, 600],
  ['popup', 400, 520], ['popup', 400, 600],
];

try {
  await rpc('CLEAR_ALL');
  await rpc('UPDATE_SETTINGS', {patch: {tracking: false, semantic: false}});
  const seedTab = await control.eval(({base, windowId, pageName}) => chrome.tabs.create({
    windowId, url: base + '/fixture/' + encodeURIComponent(pageName), active: false,
  }), {base, windowId, pageName});
  await until(async () => (await rpc('GET_STATE')).tabs.some(tab => tab.title === pageName), 'fixture title');
  for (const name of ['资料梳理', '整理待办', '计划访谈']) await rpc('SAVE_TASK', {mode: 'intent', name});
  let task = await rpc('SAVE_TASK', {name: taskName, goal, tabIds: [seedTab.id]});
  task = await rpc('SAVE_CHECKPOINT', {id: task.id, revision: task.revision, checkpoint: {
    progress: '已核对工作台的导航顺序', blocker: '仍需核对窗口切换', nextStep: next, pageId: task.pages[0].pageId,
  }});

  for (const [surface, width, height] of surfaces) {
    const page = await surfacePage(surface, width, height);
    const empty = await audit(page);
    assert(!empty.horizontalOverflow, `${surface} empty width ${width}`);
    assert(empty.actions.some(item => item.label === '新建任务' && item.firstScreen));
    assert(empty.actions.some(item => item.label === '选择已有任务' && item.firstScreen));
    await page.click('.memory-current [data-action="memory-choose-task"]');
    await until(() => page.eval(() => !!document.querySelector('.memory-task-picker[open]')), 'picker open');
    assert.equal((await rpc('GET_STATE')).work.current.taskId, null);
    await key(page, 'Escape', 'Escape', 27);
    await until(() => page.eval(() => document.activeElement?.dataset.action === 'memory-choose-task'), 'picker returns focus');
    if (surface === 'popup') { assert.equal(empty.recent, 3); assert(empty.footer); }
    report.checks.push({surface, width, height, state: 'no current task', ...empty});
    await page.close();
  }

  await rpc('SET_CURRENT_TASK', {id: task.id, revision: task.revision, contextRevision: (await rpc('GET_STATE')).work.current.revision});
  for (const [surface, width, height] of surfaces) {
    const page = await surfacePage(surface, width, height);
    const active = await audit(page);
    assert.equal(active.activeHeading, taskName);
    assert(active.text.includes(goal) && active.text.includes(next));
    assert(!active.horizontalOverflow, `${surface} active width ${width}`);
    for (const label of ['继续一页', '留断点']) assert(active.actions.some(item => item.label === label && item.firstScreen), `${surface} ${width}×${height} ${label}`);
    assert(active.manage);
    await page.screenshot(`${env.out}/screenshots/focus-${surface}-${width}x${height}.png`);
    if (surface === 'popup') { assert.equal(active.recent, 3); assert(active.footer); }
    else {
      assert(active.predictionClosed);
      await page.eval(selector => document.querySelector(selector).focus(), nextSummary);
      await key(page, 'Enter', 'Enter', 13);
      await until(() => page.eval(() => document.querySelector('#next-prediction').open), 'predictor disclosed by keyboard');
      assert.equal(await page.eval(() => document.querySelectorAll('.prediction-row').length), 0);
      await page.eval(() => document.querySelector('#predict-next').focus());
      await key(page, 'Escape', 'Escape', 27);
      await until(() => page.eval(() => !document.querySelector('#next-prediction').open && document.activeElement.id === 'next-prediction-summary'), 'Escape closes predictor and restores keyboard focus');
    }
    await page.click('.memory-current [data-action="memory-checkpoint"]');
    await page.fill('#checkpoint-nextStep', '未保存的中文草稿');
    await key(page, 'Escape', 'Escape', 27);
    await until(() => page.eval(() => document.activeElement?.id === 'checkpoint-keep-editing'), 'draft exit guard');
    await page.click('#checkpoint-keep-editing');
    assert.equal(await page.eval(() => document.querySelector('#checkpoint-nextStep').value), '未保存的中文草稿');
    assert.equal(await page.eval(() => document.activeElement?.id), 'checkpoint-nextStep');
    await key(page, 'Escape', 'Escape', 27);
    await page.click('#checkpoint-discard');
    await until(() => page.eval(() => document.activeElement?.dataset.action === 'memory-checkpoint'), 'checkpoint trigger restored');
    assert.equal((await rpc('GET_STATE')).tasks.find(item => item.id === task.id).checkpoint.nextStep, next);
    report.checks.push({surface, width, height, state: 'current task with checkpoint', ...active});
    await page.close();
  }
  console.log(`Validated ${report.checks.length} focus viewport states.`);
} catch (error) {
  report.errors.push(error.stack);
  throw error;
} finally {
  writeFileSync(env.out + '/focus-surfaces.json', JSON.stringify(report, null, 2) + '\n');
  await env.close();
}
