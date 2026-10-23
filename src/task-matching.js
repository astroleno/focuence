import { cosineSimilarity } from './grouping.js';
import { relationFor } from './task-context.js';
import { embeddingText, stableHash } from './text.js';
import { semanticItem, QUERY_INSTRUCTION } from './semantic.js';

export function words(value) {
  const out = new Set();
  for (const token of String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9+#.-]+|[\u3400-\u9fff]+/gu) || []) {
    if (/^[\u3400-\u9fff]+$/u.test(token)) {
      for (let i = 0; i < token.length - 1; i++) out.add(token.slice(i, i + 2));
    } else if (!['the', 'and', 'for', 'with', 'https', 'www', 'com'].includes(token)) out.add(token);
  }
  return out;
}

export function lexicalAffinity(query, value) {
  const a = words(query), b = words(value);
  if (!a.size || !b.size) return 0;
  return [...a].filter(word => b.has(word)).length / Math.sqrt(a.size * b.size);
}

export function goalItem(task) { return semanticItem(task.id, QUERY_INSTRUCTION + (task.goal || task.name), 'goal'); }
export function pageItem(page) { return semanticItem(page.pageId || page.id, embeddingText(page), 'page'); }

export function candidateSnapshot(page) {
  return { pageId: page.pageId || page.id, tabId: page.id, windowId: page.windowId, url: page.url, title: page.title,
    hash: stableHash(`${page.url}\n${page.title}`) };
}

export function matchTaskPages(task, pages, relations = [], vectors = new Map()) {
  const goal = goalItem(task), goalVector = vectors.get(goal.id);
  const confirmed = [...(task.pages || []), ...relations.filter(item => item.taskId === task.id && item.decision === 'related').map(item => item.page)]
    .filter(page => page && relationFor(task, page.pageId || page.id, relations).related);
  const examples = confirmed.map(page => vectors.get(pageItem(page).id)).filter(Boolean);
  const result = [];
  for (const page of [...new Map(pages.map(page => [page.pageId || page.id, page])).values()]) {
    const membership = relationFor(task, page.pageId || page.id, relations);
    if (membership.source === 'excluded') continue;
    const text = embeddingText(page);
    const lexical = lexicalAffinity(`${task.name} ${task.goal || ''}`, text);
    const vector = vectors.get(pageItem(page).id);
    const semantic = cosineSimilarity(goalVector, vector);
    const example = Math.max(0, ...examples.map(item => cosineSimilarity(item, vector) || 0));
    const score = membership.related ? 2 : Math.max(lexical, semantic || 0, example * .94);
    const hasSemantic = semantic !== null && (semantic >= .5 || example >= .7);
    if (!membership.related && lexical < .16 && !hasSemantic) continue;
    result.push({ ...candidateSnapshot(page), page: { pageId: page.pageId || page.id, url: page.url, title: page.title, tags: page.tags || [] },
      score, membership: membership.source, related: membership.related, method: membership.related ? 'confirmed' : hasSemantic ? 'semantic' : 'keywords',
      reason: membership.related ? membership.source === 'saved' ? '已保存到这个任务' : '你已确认与这个任务相关' : hasSemantic ? example > (semantic || 0) ? '与已确认资料的文字相近' : '与当前任务目标的文字相近' : '标题或网址包含任务中的关键词' });
  }
  return result.sort((a, b) => b.score - a.score || a.pageId.localeCompare(b.pageId));
}
