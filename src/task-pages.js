import {el, icon} from './ui.js';

export function taskPages(task, expanded, disabled = false) {
  const id = encodeURIComponent(task.id), pages = task.pages || [];
  return el('div', {class: 'task-page-details'},
    el('button', {id: 'task-pages-toggle-' + id, type: 'button', class: 'task-pages-toggle', 'data-action': 'toggle-task-pages', 'data-id': task.id, 'aria-expanded': expanded, 'aria-controls': 'task-pages-' + id, disabled},
      icon('chevron'), expanded ? '收起页面' : '查看 ' + pages.length + ' 个页面'),
    el('ul', {id: 'task-pages-' + id, class: 'task-pages', hidden: !expanded, 'aria-label': task.name + '的页面'}, pages.map((page, index) =>
      el('li', {}, el('button', {id: 'task-page-' + id + '-' + index, type: 'button', 'data-action': 'open-page', 'data-url': page.url, disabled},
        el('span', {}, page.title || page.url), el('small', {}, domainOf(page.url)))))));
}
function domainOf(url) { try { return new URL(url).hostname; } catch { return ''; } }
