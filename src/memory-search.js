import { embeddingText, stableHash, normalizeUrl, pageIdForUrl } from './text.js';
import { lexicalAffinity, words } from './task-matching.js';
import { semanticItem, textChunks } from './semantic.js';
import { cosineSimilarity } from './grouping.js';
import {compactMemoryResult} from './search-sources.js';

export const SEARCH_SCOPES = ['all', 'window', 'windows', 'tasks', 'history', 'browser','library'];

export function memoryCorpus({ tabs = [], tasks = [], pages = [], relations = [], segments = [], scope = 'all', allowed = () => true }) {
  const entries = new Map(), visits = new Map();
  for (const segment of segments) if (segment.status === 'active' && segment.foregroundMs > 0) visits.set(segment.pageId, Math.max(visits.get(segment.pageId) || 0, segment.endedAt));
  const addPage = (page, source, taskId = null) => {
    const url = normalizeUrl(page?.url);
    if (!url || !allowed(url)) return;
    const pageId = pageIdForUrl(url), id = `page:${pageId}`, old = entries.get(id);
    entries.set(id, { id, kind: 'page', pageId, url, title: page.title || new URL(url).hostname,
      text: embeddingText({ ...page, url }), taskIds: [...new Set([...(old?.taskIds || []), ...(taskId ? [taskId] : [])])],
      sources: [...new Set([...(old?.sources || []), source])], visitedAt: visits.get(pageId) || 0 });
  };
  if (scope === 'all' || scope === 'history') for (const page of pages) if (visits.has(page.id || page.pageId)) addPage(page, 'history');
  if (scope === 'all' || scope === 'tasks') for (const task of tasks) {
    const checkpoint = task.checkpoint;
    const fields = [task.name, task.goal, task.notes, checkpoint?.progress, checkpoint?.blocker, checkpoint?.nextStep].filter(Boolean);
    entries.set(`task:${task.id}`, { id: `task:${task.id}`, kind: 'task', taskId: task.id, taskIds: [task.id], title: task.name, text: fields.join('\n'),
      url: allowed(checkpoint?.page?.url) ? checkpoint?.page?.url : null, sources: ['task'], visitedAt: task.updatedAt || 0 });
    for (const page of task.pages || []) addPage(page, 'saved', task.id);
    for (const relation of relations) if (relation.taskId === task.id && relation.decision === 'related') addPage(relation.page, 'confirmed', task.id);
  }
  if (scope === 'all' || scope === 'window') for (const tab of tabs) addPage(tab, 'window');
  return [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function searchDocuments(entries) {
  return entries.flatMap(entry => {
    const occurrences = new Map();
    const passages = entry.searchParts
      ? entry.searchParts.flatMap(part => textChunks(part.text).map(text => ({text,field:part.field,variant:entry.searchVariants?.[0]})))
      : entry.searchVariants
        ? entry.searchVariants.flatMap(variant => textChunks(variant.text).map(text => ({text,variant})))
        : (entry.searchTexts ? entry.searchTexts.flatMap(text => textChunks(text)) : entry.kind === 'task' ? textChunks(entry.text) : [entry.text]).map(text => ({text}));
    return passages.map(({text,field,variant}) => {
      // New sources must not renumber the documents of an existing search.
      const key = `${field || 'text'}:${stableHash(text)}`, occurrence = occurrences.get(key) || 0;
      occurrences.set(key, occurrence + 1);
      const item = semanticItem(`${entry.kind === 'task' ? `${entry.taskId}:` : entry.kind==='library'?`${entry.libraryId}:`:`${entry.pageId}:`}${key}:${occurrence}`, text, entry.kind === 'task' ? 'task' : entry.kind==='library'?'library':'search-page');
      return {entryId:entry.id, field, item, variant};
    });
  });
}

export function snippetFor(query, text) {
  const lower = text.toLocaleLowerCase(), phrase = query.trim().toLocaleLowerCase();
  const exact = phrase ? lower.indexOf(phrase) : -1;
  const match = exact >= 0 ? exact : [...words(query)].map(word => lower.indexOf(word)).filter(index => index >= 0).sort((a, b) => a - b)[0] || 0;
  const start = Math.max(0, match - 28);
  return (start ? '…' : '') + text.slice(start, start + 180) + (text.length > start + 180 ? '…' : '');
}

function lexicalPassage(entry, query, normalized) {
  let winner, best = 0;
  for (const variant of entry.searchVariants || []) {
    // Prefer a named field to the whole passage when both contain the same literal match.
    for (const part of [...variant.fields, variant]) {
      const score = part.text.toLocaleLowerCase().includes(normalized) ? 2 : lexicalAffinity(query, part.text);
      if (score > best) { best = score; winner = {...part, variant}; }
    }
  }
  return winner;
}

export function rankMemory(entries, query, semanticScores = {}, limit = 50, browse = false, includeEvidenceKeys = false) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return browse?{results:[...entries].sort((a,b)=>b.visitedAt-a.visitedAt||a.id.localeCompare(b.id)).slice(0,limit).map(entry=>({...compactMemoryResult(entry),method:'filtered',snippet:(entry.text||'').slice(0,180)})),total:entries.length}:{ results: [], total: 0 };
  const ranked = entries.flatMap(entry => {
    const exact = entry.text.toLocaleLowerCase().includes(normalized);
    const lexical = lexicalAffinity(query, entry.text);
    const match = semanticScores[entry.id];
    const semantic = typeof match === 'number' ? match : match?.score ?? null;
    if (!exact && lexical < .1 && (semantic === null || semantic < .46)) return [];
    const method = exact || lexical >= .45 ? 'keywords' : semantic !== null && semantic >= .46 ? 'semantic' : 'keywords';
    const score = exact ? 1.5 + lexical : Math.max(lexical, semantic || 0) + lexical * .12;
    const document=method==='semantic'&&match?.documentId ? entry.searchDocuments?.find(doc=>doc.item.id===match.documentId) : null;
    const passage=method==='semantic'
      ? document ? {text:document.item.text,field:document.field,variant:document.variant} : {text:match?.text,field:match?.field}
      : lexicalPassage(entry,query,normalized);
    const keys=passage?.variant?.evidenceKeys;
    const matchedSources=keys ? [...new Set(keys.map(key=>key.slice(0,key.indexOf(':'))))] : [];
    return [{ ...compactMemoryResult(entry), score, method,snippetField:passage?.field,
      snippet:snippetFor(query,passage?.text||entry.text), matchedSources,
      ...(includeEvidenceKeys&&keys ? {matchedEvidenceKeys:keys} : {}) }];
  }).sort((a, b) => b.score - a.score || b.visitedAt - a.visitedAt || a.id.localeCompare(b.id));
  return { results: ranked.slice(0, limit), total: ranked.length };
}

export function accumulateSearchScores(previous, documents, vectors, queryVector) {
  const scores = { ...previous };
  for (const document of documents) {
    const score = cosineSimilarity(queryVector, vectors.get(document.item.id));
    const previous = scores[document.entryId];
    const previousScore = typeof previous === 'number' ? previous : previous?.score ?? -1;
    if (score !== null && score > previousScore) scores[document.entryId] = document.variant
      ? {score,documentId:document.item.id}
      : {score,text:document.item.text,field:document.field};
  }
  return scores;
}
