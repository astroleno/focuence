import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setup, until} from './cdp.mjs';

const out = process.argv.find(value => value.startsWith('--out='))?.slice(6) || join(tmpdir(), 'focuence-evidence-navigation');
const env = await setup({out});
const {browser, control, rpc, extensionId} = env;
const query = '唯一次匹配标题';
const opener = '.memory-results [data-action="memory-result-evidence"]';
const dialog = '.memory-dialog[open]';
const jump = `${dialog} [data-action="memory-locate-matched-evidence"]`;
const close = `${dialog} [data-action="memory-close"]`;
const next = `${dialog} [data-action="memory-result-evidence"][data-offset="25"]`;

async function settle(page) {
  await page.eval(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function search(page, text) {
  await page.fill('#memory-query', text);
  await page.click('#memory-search-submit');
  await until(() => page.eval(() => document.querySelector('.memory-search-status')?.textContent.includes('找到 1 条线索')), 'one search result');
}

try {
  await rpc('CLEAR_ALL');
  await rpc('UPDATE_SETTINGS', {patch: {tracking: false, semantic: false}});
  await rpc('SAVE_LIBRARY_ITEM', {kind: 'excerpt', url: 'https://library.fixture.test/match', title: '独立材料线索', quote: '材料原文', taskIds: []});
  await control.eval(async query => {
    const {openStore} = await import(chrome.runtime.getURL('src/store.js'));
    const {pageIdForUrl} = await import(chrome.runtime.getURL('src/text.js'));
    const store = await openStore(), url = 'https://evidence.fixture.test/record', at = Date.now() - 120000;
    try {
      const visits = Array.from({length: 53}, (_, i) => ({id: `visit-${i}`, sessionId: 'fixture',
        status: 'active', url, pageId: pageIdForUrl(url), startedAt: at + i * 1000, endedAt: at + i * 1000 + 500,
        foregroundMs: 500, title: i === 50 ? query : '普通访问记录'}));
      const more = Array.from({length: 51}, (_, i) => {
        const url = `https://paging.fixture.test/${i}`;
        return {id: `pagination-${i}`, sessionId: 'fixture', status: 'active', url, pageId: pageIdForUrl(url),
          startedAt: at + i * 1000, endedAt: at + i * 1000 + 500, foregroundMs: 500, title: '显示更多命中'};
      });
      await store.addSegments([...visits, ...more]);
    } finally {store.close();}
  }, query);

  for (const [path, width] of [['app/index.html', 1280], ['panel/index.html', 360]]) {
    const page = await browser.page(`chrome-extension://${extensionId}/${path}#search`, width, 760);
    await until(() => page.eval(() => !!document.querySelector('#memory-query')), `${path} search`);
    await page.fill('#memory-scope', 'history');
    await page.eval(() => {document.querySelector('.memory-filters').open = true;});
    await page.fill('#memory-filter-domain', 'evidence.fixture.test');
    await search(page, query);
    await page.click(opener);
    await until(() => page.eval(selector => !!document.querySelector(selector), jump), 'match jump available');
    assert.deepEqual(await page.eval(selector => {
      const frame = document.querySelector(selector);
      return [frame.querySelectorAll('article').length, frame.querySelectorAll('article[aria-describedby]').length,
        frame.querySelector('.memory-actions p').textContent];
    }, dialog), [25, 0, '1—25 / 53']);
    await page.click(jump);
    await until(() => page.eval(() => document.activeElement?.matches('.memory-evidence-row')), 'focus on matching evidence');
    assert.deepEqual(await page.eval(selector => {
      const frame = document.querySelector(selector), row = document.activeElement;
      const description = document.getElementById(row.getAttribute('aria-describedby'));
      return [frame.querySelector('.memory-actions p').textContent, frame.querySelectorAll('article[tabindex="-1"]').length,
        description?.textContent, row.innerText.includes('唯一次匹配标题'), getComputedStyle(row).outlineStyle];
    }, dialog), ['51—53 / 53', 1, '含匹配片段', true, 'solid']);
    await page.click(next);
    await until(() => page.eval(selector => document.querySelector(`${selector} .memory-actions p`)?.textContent === '26—50 / 53', dialog), 'ordinary previous page');
    await page.click(close);
    await until(() => page.eval(selector => document.activeElement === document.querySelector(selector), opener), 'return focus to the result');

    await page.eval(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      const gate = globalThis.evidenceGate = {paused: true, releases: []};
      chrome.runtime.sendMessage = async message => {
        const response = await original(message);
        if (message.type !== 'GET_MEMORY_EVIDENCE' || !gate.paused) return response;
        return new Promise(resolve => gate.releases.push(fail => resolve(fail ? {ok: false, error: 'late evidence test error'} : response)));
      };
    });
    const queued = count => until(() => page.eval(count => evidenceGate.releases.length === count, count), `held evidence response ${count}`);
    const release = (index, fail) => page.eval((index, fail) => evidenceGate.releases[index](fail), index, fail);

    await page.click(opener);
    await queued(1);
    await page.fill('#memory-query', '普通访问记录');
    await page.click('#memory-search-submit');
    await until(() => page.eval(() => document.querySelector('.memory-results .memory-snippet')?.textContent === '普通访问记录'), 'replacement search painted');
    await release(0, false);
    await settle(page);
    assert.equal(await page.eval(selector => !!document.querySelector(selector), dialog), false);

    await page.click(opener);
    await queued(2);
    await page.eval(() => location.hash = 'tasks');
    await until(() => page.eval(() => !document.querySelector('#memory-query')), 'left search view');
    await release(1, true);
    await settle(page);
    assert.equal(await page.eval(selector => !!document.querySelector(selector) || document.querySelector('#toast-region').textContent.includes('late evidence test error'), dialog), false);
    await page.eval(() => location.hash = 'search');
    await until(() => page.eval(() => !!document.querySelector('#memory-query')), 'returned to search view');
    await search(page, query);

    await page.eval(() => {evidenceGate.paused = false;});
    await page.click(opener);
    await until(() => page.eval(selector => !!document.querySelector(selector), jump), 'reopened evidence');
    await page.eval(() => {evidenceGate.paused = true;});
    await page.click(next);
    await queued(3);
    await page.click(jump);
    await queued(4);
    await release(3, false);
    await until(() => page.eval(() => document.activeElement?.matches('.memory-evidence-row')), 'most recent evidence request wins');
    await release(2, false);
    await settle(page);
    assert.equal(await page.eval(selector => document.querySelector(`${selector} .memory-actions p`).textContent, dialog), '51—53 / 53');
    await page.click(next);
    await queued(5);
    await page.click(close);
    await release(4, false);
    await settle(page);
    assert.equal(await page.eval(selector => !!document.querySelector(selector), dialog), false);

    await page.eval(() => {evidenceGate.paused = false;});
    await search(page, '');
    await page.click(opener);
    await until(() => page.eval(selector => !!document.querySelector(selector), dialog), 'filtered evidence');
    assert.equal(await page.eval(selector => !!document.querySelector(selector), jump), false);
    assert.equal(await page.eval(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.click(close);

    await page.fill('#memory-filter-domain', 'paging.fixture.test');
    await page.fill('#memory-query', '显示更多命中');
    await page.click('#memory-search-submit');
    const resultNext = '[data-action="memory-result-pagination"][data-offset="50"]';
    await until(() => page.eval(selector => !!document.querySelector(selector), resultNext), 'search result pagination');
    await page.eval(() => {evidenceGate.paused = true;});
    await page.click(opener);
    await queued(6);
    await page.click(resultNext);
    await until(() => page.eval(() => document.querySelectorAll('.memory-results article').length === 1), 'second search result page');
    await release(5, false);
    await settle(page);
    assert.equal(await page.eval(selector => !!document.querySelector(selector), dialog), false);

    await page.fill('#memory-scope', 'library');
    await page.fill('#memory-filter-domain', '');
    await search(page, '独立材料线索');
    const material = '.memory-results [data-action="memory-result-library"]';
    await page.click(opener);
    await queued(7);
    await page.click(material);
    await until(() => page.eval(() => !!document.querySelector('.library-dialog[open]')), 'material replaces pending evidence');
    const libraryClose = '.library-dialog[open] .memory-heading button';
    await page.click(libraryClose);
    await release(6, true);
    await settle(page);
    assert.equal(await page.eval(selector => !!document.querySelector(selector) || document.querySelector('#toast-region').textContent.includes('late evidence test error'), dialog), false);
    await page.close();
    console.log(`Passed evidence navigation and response lifecycle on ${path}`);
  }
  assert.deepEqual(browser.events.filter(event => event.method === 'Runtime.exceptionThrown'), []);
} finally {
  await env.close();
}
