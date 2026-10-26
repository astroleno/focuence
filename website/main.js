// Synthetic examples only: no extension APIs, analytics, or persistent storage.
const defaults = Object.freeze({
  goal: '完成产品方案初稿',
  nextStep: '把研究结论整理成三个设计原则',
  checkpoint: '研究资料已看完。接着把三个设计原则写进方案，再补上对应的参考。',
});
const themes = {
  research: { title: '资料研究', minutes: 18, description: '从资料里找依据，再把线索带回方案。', route: '资料研究 → 方案写作 · 6 次', pages: [['研', '访谈摘要与观察', '整理问题与使用场景'], ['例', '相关案例笔记', '对照不同的解决方法']] },
  writing: { title: '方案写作', minutes: 26, description: '研究和参考之后，回到正在写的方案。', route: '资料研究 → 方案写作 · 6 次', pages: [['文', '产品方案 · 工作稿', '正在编辑的文档'], ['纲', '研究结论与提纲', '整理过的写作线索']] },
  reference: { title: '视觉参考', minutes: 12, description: '带着问题看参考，再回到自己的表达。', route: '方案写作 → 视觉参考 · 3 次；返回 · 2 次', pages: [['版', '信息层级参考', '对照阅读与排列方式'], ['图', '交互细节收集', '留下值得再看的线索']] },
  detour: { title: '临时岔路', minutes: 6, description: '偶尔换个方向很正常。看见之后，再决定要去哪里。', route: '方案写作 → 临时岔路 · 1 次', pages: [['读', '一篇顺手打开的文章', '临时感兴趣的内容'], ['讯', '资讯列表', '从工作稿切换而来']] },
};
const $ = (selector) => document.querySelector(selector);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const status = $('#demo-status');
let goal = defaults.goal;
let nextStep = defaults.nextStep;
let checkpoint = defaults.checkpoint;

function say(message) { status.textContent = message; }

function showView(view, { focus = false, scroll = false } = {}) {
  const selectedTab = tabs.find((tab) => tab.dataset.view === view);
  if (!selectedTab) return;
  for (const tab of tabs) {
    const selected = tab === selectedTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) selectedTab.focus({ preventScroll: true });
  if (scroll) $('#experience').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

function selectTheme(id, announce = true) {
  const theme = themes[id];
  if (!theme) return;
  for (const node of document.querySelectorAll('[data-theme]')) {
    const selected = node.dataset.theme === id;
    node.classList.toggle('is-selected', selected);
    node.setAttribute('aria-pressed', String(selected));
  }
  for (const edge of document.querySelectorAll('[data-connect]')) edge.classList.toggle('is-muted', !edge.dataset.connect.split(' ').includes(id));
  $('#theme-title').textContent = theme.title;
  $('#theme-description').textContent = theme.description;
  const unit = document.createElement('span');
  unit.textContent = ' 分钟';
  $('#theme-time').replaceChildren(document.createTextNode(String(theme.minutes)), unit);
  $('#theme-route').textContent = theme.route;
  const rows = theme.pages.map(([symbol, title, detail]) => {
    const li = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = 'page-symbol';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = symbol;
    const text = document.createElement('span');
    text.textContent = title;
    const small = document.createElement('small');
    small.textContent = detail;
    text.append(small);
    li.append(icon, text);
    return li;
  });
  $('#theme-pages').replaceChildren(...rows);
  if (announce) say(`已选择「${theme.title}」。右侧或下方显示对应的示例页面与访问线索。`);
}

function renderGoal() {
  $('#focus-preview-goal').textContent = goal;
  $('#focus-preview-step').textContent = nextStep;
  $('#resume-goal').textContent = goal;
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    showView(tab.dataset.view);
    say({ map: '点选一个主题，查看示例访问线索。', focus: '试着改写目标与下一步，再设为示例目标。', resume: '写下停在哪里，保存后就能继续这个示例。' }[tab.dataset.view]);
  });
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    showView(tabs[next].dataset.view, { focus: true });
  });
}
for (const node of document.querySelectorAll('[data-theme]')) node.addEventListener('click', () => selectTheme(node.dataset.theme));
for (const button of document.querySelectorAll('[data-go]')) button.addEventListener('click', () => {
  showView(button.dataset.go, { focus: true, scroll: true });
  say({ map: '地图中的主题都可以点选。', focus: '把眼前的工作写成一个明确目标。', resume: '留下一句话，给下次的自己。' }[button.dataset.go]);
});

function requireText(input) {
  input.setCustomValidity(input.value.trim() ? '' : '请写下一点内容，再继续示例。');
  return input.reportValidity();
}
for (const input of document.querySelectorAll('input, textarea')) input.addEventListener('input', () => input.setCustomValidity(''));
$('#focus-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!requireText($('#goal')) || !requireText($('#next-step'))) return;
  goal = $('#goal').value.trim();
  nextStep = $('#next-step').value.trim();
  renderGoal();
  say('示例目标已更新。需要中断时，可以切到「断点继续」留下线索。');
});
$('#checkpoint-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!requireText($('#checkpoint'))) return;
  checkpoint = $('#checkpoint').value.trim();
  $('#saved-checkpoint').textContent = checkpoint;
  say('示例断点已保存到本页。点「继续这个示例」可带着线索回到目标。');
});
$('#resume-button').addEventListener('click', () => {
  // Restore saved state; unsaved input must not become a checkpoint.
  $('#goal').value = goal;
  $('#next-step').value = nextStep;
  $('#goal').setCustomValidity('');
  $('#next-step').setCustomValidity('');
  showView('focus', { focus: true });
  say(`已回到示例目标「${goal}」。断点：${checkpoint}`);
});
$('#reset-demo').addEventListener('click', () => {
  goal = defaults.goal;
  nextStep = defaults.nextStep;
  checkpoint = defaults.checkpoint;
  $('#focus-form').reset();
  $('#checkpoint-form').reset();
  for (const input of document.querySelectorAll('input, textarea')) input.setCustomValidity('');
  $('#saved-checkpoint').textContent = checkpoint;
  renderGoal();
  selectTheme('writing', false);
  showView('map');
  say('示例已重置。这里的内容都是合成数据，不会读取你的浏览记录。');
});
selectTheme('writing', false);
