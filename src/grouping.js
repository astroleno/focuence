import { pageFromTab, projectIdentity, stableHash, topicHints } from './text.js';

const COLORS = ['blue', 'cyan', 'orange', 'green', 'purple', 'pink'];
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'how', 'what', 'guide', 'docs', 'documentation', 'github', 'com', 'www', 'https', 'http', '教程', '如何', '一个', '使用', '什么', '以及', '关于', '文档', '指南', '方法', '介绍', '页面', '最新', '下载']);

function titleTokens(title) {
  const tokens = String(title).toLowerCase().match(/[a-z0-9][a-z0-9.+#-]{1,}|[\u3400-\u9fff]{2,}/g) || [];
  const out = new Set();
  for (const token of tokens) {
    if (STOP_WORDS.has(token)) continue;
    if (/^[\u3400-\u9fff]+$/.test(token)) {
      for (let i = 0; i + 1 < token.length; i++) {
        const bigram = token.slice(i, i + 2);
        if (!STOP_WORDS.has(bigram)) out.add(bigram);
      }
    } else out.add(token);
  }
  return out;
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return null;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return null;
    dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];
  }
  if (!aa || !bb) return null;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb)));
}

function vectorFor(embeddings, id) {
  const item = embeddings instanceof Map ? embeddings.get(id) : embeddings?.[id];
  const vector = item?.vector || item?.embedding || item;
  return Array.isArray(vector) || ArrayBuffer.isView(vector) ? vector : null;
}

function conflict(a, b) {
  return a.windowId !== b.windowId || Boolean(a.project && b.project && a.project.kind === b.project.kind && a.project.key !== b.project.key);
}

function ruleAffinity(a, b) {
  if (conflict(a, b)) return null;
  if (a.page.id === b.page.id) return { score: 1, key: `url:${a.page.id}`, name: a.page.title, reason: '相同页面的多个标签页' };
  if (a.project && b.project && a.project.key === b.project.key) return { score: .98, key: a.project.key, name: a.project.name, reason: `同一项目：${a.project.name}` };
  const commonTopic = a.topics.find(topic => b.topics.some(other => other.key === topic.key));
  if (commonTopic) return { score: .86, key: `topic:${commonTopic.key}`, name: commonTopic.label, reason: `页面文字共同提到「${commonTopic.label}」` };
  const common = [...a.tokens].filter(token => b.tokens.has(token));
  const union = new Set([...a.tokens, ...b.tokens]).size;
  const ratio = union ? common.length / union : 0;
  if (common.length >= 2 && ratio >= .48) return { score: .72 + .18 * ratio, key: null, name: null, reason: '页面标题包含相近的主题词' };
  return null;
}

function semanticAffinity(a, b, threshold) {
  if (conflict(a, b)) return null;
  const score = cosineSimilarity(a.vector, b.vector);
  return score !== null && score >= threshold ? { score, key: null, name: null, reason: '本机语义模型发现相近内容', semantic: true } : null;
}

function affinity(a, b, options) {
  return ruleAffinity(a, b) || (options.semantic ? semanticAffinity(a, b, options.threshold) : null);
}

function clusterMatch(candidate, cluster, options) {
  if (cluster.members.some(member => conflict(candidate, member))) return null;
  const matches = cluster.members.map(member => affinity(candidate, member, options));
  // Complete-link membership prevents an A≈B≈C chain from swallowing unrelated A/C.
  if (matches.some(match => !match)) return null;
  const strongest = [...matches].sort((a, b) => b.score - a.score)[0];
  return {
    ...strongest,
    score: matches.reduce((sum, match) => sum + match.score, 0) / matches.length,
    semantic: matches.some(match => match.semantic),
  };
}

function groupName(cluster) {
  if (cluster.previous?.name) return String(cluster.previous.name).slice(0, 60);
  const first = cluster.members[0];
  const sameProject = first.project && cluster.members.every(item => item.project?.key === first.project.key);
  if (sameProject) return first.project.name.slice(0, 60);
  const common = first.topics.find(topic => cluster.members.every(item => item.topics.some(other => other.key === topic.key)));
  if (common) return common.label;
  const titles = cluster.members.map(item => item.page.title);
  if (titles.every(title => title === titles[0])) return titles[0].slice(0, 30);
  const useful = [...first.tokens].filter(token => cluster.members.every(item => item.tokens.has(token)));
  const latin = useful.filter(token => /^[a-z0-9]/i.test(token));
  if (latin.length) return latin.slice(0, 3).join(' ').slice(0, 36);
  const han = useful.filter(token => /^[\u3400-\u9fff]/.test(token));
  if (han.length) {
    let label = han[0];
    for (const token of han.slice(1)) if (label.endsWith(token[0])) label += token.slice(1);
    if (label.length >= 3) return label.slice(0, 24);
  }
  return `${first.page.title.slice(0, 18)} · 相关`;
}

/**
 * Build conservative proposals. This function NEVER modifies Chrome tabs.
 * Pinned, incognito and existing browser groups remain untouched. Singletons stay ungrouped.
 * `confidence` is a heuristic affinity, not a calibrated correctness probability.
 * Pass previousGroups for incremental stability between proposals; changed pages are re-evaluated.
 */
export function proposeGroups(tabs, options = {}) {
  const settings = {
    semantic: options.semantic === true,
    threshold: Number.isFinite(options.threshold) ? Math.min(.99, Math.max(.5, options.threshold)) : .76,
    maxGroupSize: Number.isInteger(options.maxGroupSize) ? Math.max(2, Math.min(50, options.maxGroupSize)) : 20,
  };
  const seenTabs = new Set();
  const candidates = (Array.isArray(tabs) ? tabs : []).flatMap(tab => {
    if (!Number.isInteger(tab?.id) || seenTabs.has(tab.id) || tab.pinned || tab.incognito || (Number.isInteger(tab.groupId) && tab.groupId >= 0)) return [];
    const page = pageFromTab(tab, options.now ?? Date.now());
    if (!page) return [];
    seenTabs.add(tab.id);
    return [{ tabId: tab.id, windowId: Number.isInteger(tab.windowId) ? tab.windowId : 0, page, project: projectIdentity(page.url), topics: topicHints(page), tokens: titleTokens(page.title), vector: vectorFor(options.embeddings, page.id) }];
  }).sort((a, b) => a.windowId - b.windowId || a.page.id.localeCompare(b.page.id) || a.tabId - b.tabId);
  const byTab = new Map(candidates.map(candidate => [candidate.tabId, candidate]));
  const assigned = new Set();
  const clusters = [];
  for (const previous of options.previousGroups || []) {
    const current = (previous.tabIds || []).map(id => byTab.get(id)).filter(item => item && !assigned.has(item.tabId));
    if (!current.length) continue;
    const oldPages = new Map((previous.pages || []).map(page => [page.id, page]));
    const unchanged = current.filter(item => !oldPages.size || oldPages.get(item.page.id)?.title === item.page.title);
    if (!unchanged.length) continue;
    const cluster = { members: [unchanged[0]], previous, evidence: [] };
    assigned.add(unchanged[0].tabId);
    for (const candidate of unchanged.slice(1)) {
      const match = clusterMatch(candidate, cluster, settings);
      if (match && cluster.members.length < settings.maxGroupSize) {
        cluster.members.push(candidate); cluster.evidence.push(match); assigned.add(candidate.tabId);
      }
    }
    clusters.push(cluster);
  }
  for (const candidate of candidates) {
    if (assigned.has(candidate.tabId)) continue;
    let best = null;
    for (const cluster of clusters) {
      if (cluster.members.length >= settings.maxGroupSize) continue;
      const match = clusterMatch(candidate, cluster, settings);
      if (match && (!best || match.score > best.match.score + 1e-9)) best = { cluster, match };
    }
    if (best) { best.cluster.members.push(candidate); best.cluster.evidence.push(best.match); }
    else clusters.push({ members: [candidate], previous: null, evidence: [] });
    assigned.add(candidate.tabId);
  }
  return clusters.filter(cluster => cluster.members.length >= 2).map(cluster => {
    const first = cluster.members[0];
    const semantic = cluster.evidence.some(evidence => evidence.semantic);
    const uniquePages = [...new Map(cluster.members.map(item => [item.page.id, item.page])).values()];
    const id = cluster.previous?.id || `g_${stableHash(`${first.windowId}:${first.page.id}`)}`;
    return {
      id,
      name: groupName(cluster),
      color: COLORS[Number.parseInt(stableHash(id).slice(-4), 16) % COLORS.length],
      reason: semantic ? '标题与网址信息的语义相近（本机 BGE），保留已识别的项目边界' : (cluster.evidence[0]?.reason || '页面具有共同主题'),
      confidence: Number((cluster.evidence.reduce((sum, evidence) => sum + evidence.score, 0) / Math.max(1, cluster.evidence.length)).toFixed(3)),
      tabIds: cluster.members.map(item => item.tabId).sort((a, b) => a - b),
      pages: uniquePages,
      method: semantic ? 'semantic' : 'rules',
      windowId: first.windowId,
    };
  }).sort((a, b) => b.tabIds.length - a.tabIds.length || a.id.localeCompare(b.id));
}
