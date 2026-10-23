import {el} from './ui.js';

const graphemes = new Intl.Segmenter('zh-CN', {granularity: 'grapheme'});
let measureFrame;
function measureNotes() {
  cancelAnimationFrame(measureFrame);
  measureFrame = requestAnimationFrame(() => {
    for (const container of document.querySelectorAll('.task-notes')) {
      const copy = container.querySelector('.task-note'), toggle = container.querySelector('.note-toggle');
      toggle.hidden = container.dataset.summaryMore !== 'true' && toggle.getAttribute('aria-expanded') !== 'true' && copy.scrollHeight <= copy.clientHeight + 1;
    }
  });
}
if (typeof window !== 'undefined') window.addEventListener('resize', measureNotes);

/** Summarize display text only; never shorten the saved note or split an emoji. */
export function notePreview(value, limit = 60, lines = 3) {
  const text = String(value || '').trim();
  const allLines = text.split(/\r\n?|\n/);
  const firstLines = allLines.slice(0, lines).join('\n');
  const characters = [...graphemes.segment(firstLines)].map(item => item.segment);
  const hasMore = allLines.length > lines || characters.length > limit;
  return {text, summary: hasMore ? characters.slice(0, limit).join('').trimEnd() + '…' : text, hasMore};
}

export function taskNotes(task, expanded = false) {
  const note = notePreview(task.notes);
  if (!note.text) return null;
  const key = encodeURIComponent(task.id);
  const container = el('div', {class: 'task-notes', 'data-summary-more': note.hasMore},
    el('div', {class: 'note-heading'}, el('span', {}, '任务笔记'), el('button', {
      id: 'note-toggle-' + key, type: 'button', class: 'note-toggle',
      'data-action': 'toggle-task-note', 'data-id': task.id,
      'aria-expanded': expanded, 'aria-controls': 'note-copy-' + key,
      'aria-label': (expanded ? '收起' : '展开') + '“' + task.name + '”的任务笔记'
    }, expanded ? '收起' : '展开')),
    el('p', {id: 'note-copy-' + key, class: 'task-note' + (expanded ? '' : ' note-preview')}, expanded ? note.text : note.summary));
  measureNotes();
  return container;
}
