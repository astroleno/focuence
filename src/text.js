/** Shared, browser-independent page identity and short-text helpers. */
const TRACKING_PARAM = /^(utm_.+|fbclid|gclid|dclid|msclkid|yclid|igshid|mc_cid|mc_eid|_ga|_gl|spm|scm)$/i;
const PRIVATE_PARAM = /^(access[_-]?token|refresh[_-]?token|id[_-]?token|token|auth|authorization|auth[_-]?token|api[_-]?key|secret|password|passwd|pwd|session|sessionid|session_id|sid|code|signature|sig|jwt|ticket|credential|x-amz-.+|x-goog-.+)$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

function cleanSearch(params) {
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAM.test(key) || PRIVATE_PARAM.test(key)) params.delete(key);
  }
  // URLSearchParams.sort is stable, preserving repeated parameter value order.
  params.sort();
}

/** Sanitize saved identity, without collapsing meaningful search queries or SPA routes. */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 16384) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.username = '';
    url.password = '';
    cleanSearch(url.searchParams);
    const hash = url.hash;
    url.hash = '';
    // Ordinary document anchors share a page; hash-routed applications do not.
    if (/^#!?\//.test(hash)) {
      const bang = hash.startsWith('#!') ? '!' : '';
      const route = new URL(hash.slice(bang ? 2 : 1), 'https://route.invalid');
      cleanSearch(route.searchParams);
      url.hash = `${bang}${route.pathname}${route.search}`;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** FNV-1a 64-bit over UTF-8. Identifiers are stable, not a privacy/anonymization scheme. */
export function stableHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(String(value))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function pageIdForUrl(raw) {
  const url = normalizeUrl(raw);
  return url ? `p_${stableHash(url)}` : null;
}

export function cleanTitle(raw, rawUrl = '') {
  let title = String(raw || '').replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  title = title.replace(/^\(\d{1,5}\)\s+/, '');
  // Only remove well-known site chrome; do not rewrite the actual document title.
  title = title.replace(/\s+[-–—|·]\s+(GitHub|YouTube|哔哩哔哩|知乎|百度一下|Google 搜索|Google Search)$/i, '').trim();
  if (!title) {
    const url = normalizeUrl(rawUrl);
    title = url ? new URL(url).hostname : '未命名页面';
  }
  return [...title].slice(0, 240).join('');
}

function decoded(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export const TOPICS = Object.freeze([
  { key: 'esp32', label: 'ESP32', test: /\besp32(?:[-_][a-z0-9]+)?\b|espressif|乐鑫/i },
  { key: 'arduino', label: 'Arduino', test: /\barduino\b/i },
  { key: 'local-ai', label: '端侧 AI', test: /\bonnx\b|transformers[.\s-]?js|\bwebgpu\b|\bbge[-_ ]|端侧(?:AI|模型|推理)|本地(?:大模型|模型|推理)/i },
  { key: 'chrome-extension', label: '浏览器扩展', test: /chrome[\s-]+extension|browser[\s-]+extension|manifest[\s-]*v?3|浏览器扩展|chrome扩展/i },
  { key: 'blender', label: 'Blender', test: /\bblender\b/i },
  { key: 'threejs', label: 'Three.js', test: /\bthree[.\s-]?js\b/i },
  { key: 'figma', label: 'Figma', test: /\bfigma\b/i },
  { key: 'aigc-video', label: 'AI 视频', test: /视频生成|生成视频|图生视频|文生视频|\b(?:kling|runway|sora|veo)[\s\d._-]|可灵|即梦/i },
]);

/** High-specificity topic rules used as grouping hints, never as completion claims. */
export function topicHints(page) {
  const url = normalizeUrl(page?.url);
  const source = `${cleanTitle(page?.title, url || '')} ${url ? decoded(new URL(url).pathname) : ''} ${page?.domain || ''}`;
  return TOPICS.filter(topic => topic.test.test(source));
}

export function inferTags(page) {
  const tags = topicHints(page).map(topic => topic.label);
  const source = `${page?.title || ''} ${page?.domain || ''} ${page?.url || ''}`;
  const broad = [
    ['开发', /github\.com|gitlab\.com|stackoverflow|developer\.|\b(?:javascript|typescript|python|react|rust|api|sdk)\b|编程|代码|开发文档/i],
    ['设计', /设计|排版|字体|交互|原型|\b(?:figma|typography|dribbble|behance)\b/i],
    ['3D', /\b(?:blender|three\.js|webgl|gltf|glb|unity|unreal)\b|三维|建模|材质/i],
    ['硬件', /esp32|arduino|espressif|电路|单片机|传感器|树莓派|嵌入式/i],
    ['旅行', /旅行|旅游|行程|徒步|景点|酒店|航班|tripadvisor|booking\.com/i],
    ['生活', /食谱|烹饪|咖啡|养护|做法|美食|菜谱/i],
    ['购物', /taobao\.com|tmall\.com|jd\.com|amazon\.|京东|淘宝|购物/i],
    ['阅读', /wikipedia\.org|维基百科|论文|arxiv\.org|新闻|研究报告/i],
    ['媒体', /youtube\.com|bilibili\.com|spotify\.com|音乐|播客/i],
  ];
  for (const [label, regex] of broad) if (regex.test(source) && !tags.includes(label)) tags.push(label);
  return tags.length ? tags.slice(0, 4) : ['其他'];
}

export function pageFromTab(tab, now = Date.now()) {
  if (!tab || tab.incognito) return null;
  const url = normalizeUrl(tab.url || tab.pendingUrl);
  if (!url) return null;
  const page = {
    id: pageIdForUrl(url),
    url,
    title: cleanTitle(tab.title, url),
    domain: new URL(url).hostname.replace(/^www\./, ''),
    tags: [],
    lastSeen: Number.isFinite(now) ? now : Date.now(),
  };
  // Persisted/user tags are additive. Never trust arbitrary HTML as a tag.
  const provided = Array.isArray(tab.tags)
    ? tab.tags.filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.replace(CONTROL_CHARS, '').trim().slice(0, 40))
    : [];
  page.tags = [...new Set([...provided, ...inferTags(page)])].slice(0, 6);
  return page;
}

/** Compact symmetric text: BGE clustering does not require a retrieval-query prefix. */
export function embeddingText(page) {
  const url = normalizeUrl(page?.url);
  if (!url) return '';
  const parsed = new URL(url);
  const path = decoded(`${parsed.pathname}${parsed.hash}`).replace(/[/#_]+/g, ' ').slice(0, 180);
  const description = String(page?.description || '').replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').slice(0, 360);
  return [cleanTitle(page?.title, url), page?.domain || parsed.hostname, path, description].filter(Boolean).join('\n').slice(0, 800);
}

/** Public code/design project identity prevents accidental same-domain megagroups. */
export function projectIdentity(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return null;
  const url = new URL(normalized);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const parts = decoded(url.pathname).split('/').filter(Boolean);
  const reserved = new Set(['search', 'explore', 'topics', 'settings', 'notifications', 'marketplace', 'login', 'signup', 'orgs', 'users', 'collections', 'features', 'pricing', 'about']);
  if (['github.com', 'codeberg.org', 'bitbucket.org', 'gitlab.com'].includes(host) && parts.length >= 2 && !reserved.has(parts[0].toLowerCase())) {
    const segments = host === 'gitlab.com'
      ? (parts.includes('-') ? parts.slice(0, parts.indexOf('-')) : parts)
      : parts.slice(0, 2);
    const name = segments.join('/').replace(/\.git$/i, '');
    return { kind: 'repo', key: `repo:${host}/${name.toLowerCase()}`, name };
  }
  if (host === 'figma.com' && ['file', 'design', 'proto', 'board', 'slides'].includes(parts[0]) && parts[1]) {
    return { kind: 'design', key: `design:${parts[1]}`, name: parts[2]?.replace(/-/g, ' ') || 'Figma 项目' };
  }
  if (host === 'docs.google.com' && parts[1] === 'd' && parts[2]) {
    return { kind: 'document', key: `document:${parts[0]}/${parts[2]}`, name: '同一文档' };
  }
  return null;
}
