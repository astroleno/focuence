import { computeAnalytics, computeReview } from '../src/analytics.js';
import { taskViews } from '../src/tasks.js';

// Explicit, memory-only preview. This module never reads or writes extension storage.
// Loaded only when the workbench URL contains ?demo=1.
export function createDemoTransport() {
  const now = Date.now();
  const midnight = new Date().setHours(0, 0, 0, 0);
  const minute = 60000;
  const data = [
    ['ESP32-S3 音频开发指南', 'docs.espressif.com', 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/', ['声音与硬件', 'ESP32'], 22],
    ['I2S 音频输出与麦克风采集', 'github.com', 'https://github.com/espressif/esp-adf', ['声音与硬件', '开源代码'], 16],
    ['便携音箱的结构与材料参考', 'design.example', 'https://design.example/audio-materials', ['声音与硬件', '产品设计'], 8],
    ['端侧语义模型 · 模型卡', 'huggingface.co', 'https://huggingface.co/BAAI/bge-small-zh-v1.5', ['本地模型', '浏览工具'], 12],
    ['Transformers.js 浏览器推理文档', 'huggingface.co', 'https://huggingface.co/docs/transformers.js', ['本地模型', '开源代码'], 18],
    ['Chrome 标签页 API', 'developer.chrome.com', 'https://developer.chrome.com/docs/extensions/reference/api/tabs', ['浏览工具', '开源代码'], 11],
    ['网页前台时间记录的设计', 'notes.example', 'https://notes.example/browser-time', ['浏览工具', '产品设计'], 7],
    ['自然光下的产品摄影参考', 'visual.example', 'https://visual.example/product-light', ['视觉创作', '产品摄影'], 9],
    ['电商详情页 · 信息层级研究', 'notes.example', 'https://notes.example/product-story', ['视觉创作', '产品设计'], 6],
    ['色彩与材质的表达笔记', 'visual.example', 'https://visual.example/material-color', ['视觉创作', '产品摄影'], 5],
    ['项目文档 · 工作记录', 'docs.example', 'https://docs.example/work-log', ['工作记录'], 4],
    ['日历', 'calendar.example', 'https://calendar.example/', ['日程'], 2]
  ];
  let nextTabId = 113;
  const pages = data.map((entry, index) => ({
    id: 'demo-page-' + (index + 1), title: entry[0], domain: entry[1], url: entry[2],
    tags: entry[3], lastSeen: now - index * minute
  }));
  let tabs = pages.map((page, index) => ({
    id: 101 + index, pageId: page.id, title: page.title, domain: page.domain,
    url: page.url, tags: page.tags.slice(), foregroundMs: data[index][4] * minute,
    windowId: 1, groupId: index === 10 ? 3 : -1, pinned: index === 11, active: index === 0
  }));
  const toTaskPages = (ids) => pages.filter((_, index) => ids.includes(index)).map((page) => ({
    pageId: page.id, title: page.title, url: page.url, tags: page.tags.slice()
  }));
  let tasks = [
    {id: 'demo-task-audio', name: '声音陪伴小装置', color: 'green', locked: true, createdAt: now - 86400000 * 4, updatedAt: now - 86400000, notes: '下一次从音频采集和播放链路继续，确认麦克风与扬声器的接线。', pages: toTaskPages([0, 1, 2])},
    {id: 'demo-task-local', name: '让浏览器更轻一点', color: 'orange', locked: true, createdAt: now - 86400000 * 2, updatedAt: now - 2 * 3600000, notes: '优先跑通本地语义分组，再把时间记录接到任务恢复。', pages: toTaskPages([3, 4, 5, 6])},
    {id: 'demo-task-visual', name: '产品视觉参考', color: 'blue', locked: true, createdAt: now - 86400000 * 3, updatedAt: now - 86400000 * 2, notes: '光线、材质与信息层级：留住值得回看的参考。', pages: toTaskPages([7, 8, 9])}
  ];
  const order = [0, 1, 0, 2, 3, 4, 5, 6, 3, 7, 8, 9, 7, 0, 1, 5];
  let cursor = midnight + 8 * 3600000 + 40 * minute;
  let segments = order.map((pageIndex, index) => {
    const page = pages[pageIndex];
    const duration = (index % 4 + 3) * minute;
    const segment = {
      id: 'demo-segment-' + index, pageId: page.id, url: page.url, title: page.title,
      tags: page.tags.slice(), taskId: null, startedAt: cursor, endedAt: cursor + duration,
      foregroundMs: duration, status: 'active', endReason: 'tab-switch'
    };
    cursor += duration + (index === 7 ? 8 * minute : 0);
    return segment;
  });
  segments.splice(8, 0, {
    id: 'demo-idle', pageId: pages[6].id, url: pages[6].url, title: pages[6].title,
    tags: pages[6].tags.slice(), taskId: null, startedAt: segments[7].endedAt,
    endedAt: segments[7].endedAt + 8 * minute, foregroundMs: 0, status: 'idle', endReason: 'idle'
  });
  segments.push({
    id: 'demo-yesterday', pageId: pages[7].id, url: pages[7].url, title: pages[7].title,
    tags: pages[7].tags.slice(), taskId: 'demo-task-visual',
    startedAt: midnight - 86400000 + 15 * 3600000, endedAt: midnight - 86400000 + 15 * 3600000 + 17 * minute,
    foregroundMs: 17 * minute, status: 'active', endReason: 'window-blur'
  });
  let settings = {tracking: true, semantic: true, idleSeconds: 120, retentionDays: 30, excludedDomains: []};
  let model = {status: 'idle', name: 'BGE-small-zh-v1.5 · 本地', progress: 0};
  let groups = [];
  let lastApply = null;
  function makeGroups(semantic) {
    const definitions = [
      {id: 'audio', name: '声音与硬件', color: 'green', ids: [101, 102, 103], reason: '音频开发、开源代码与结构参考，共同服务于一个小装置。'},
      {id: 'browser', name: '本地浏览工具', color: 'orange', ids: [104, 105, 106, 107], reason: '端侧推理、标签页管理和前台时间记录，形成一条研究线。'},
      {id: 'visual', name: '产品视觉', color: 'blue', ids: [108, 109, 110], reason: '自然光、材质与详情页表达，可以放在一起回看。'}
    ];
    return definitions.map((definition) => {
      const selected = tabs.filter((tab) => definition.ids.includes(tab.id) && !tab.pinned && tab.groupId < 0);
      return {
        id: 'demo-group-' + definition.id, name: definition.name, color: definition.color,
        reason: semantic ? definition.reason : '根据页面标题与已有主题，生成快速分组建议。',
        confidence: semantic ? .88 : .7, tabIds: selected.map((tab) => tab.id),
        pages: selected.map((tab) => pages.find((page) => page.id === tab.pageId)).filter(Boolean),
        method: semantic ? 'semantic' : 'rules'
      };
    }).filter((group) => group.tabIds.length >= 2);
  }
  groups = makeGroups(false);
  function state(range = 'week') {
    const { segments: scoped, transitions, ...attention } = computeReview({ segments, tasks, range, now: Date.now() });
    const summaries = computeAnalytics({ segments, tasks, pages, now: Date.now() });
    return {
      version: '2.1.0', windowId: 1, settings, tabs, tasks: taskViews(tasks, tabs, segments),
      segments: scoped.slice(-2000), timelineTruncated: scoped.length > 2000,
      groups, model, undoAvailable: Boolean(lastApply), ...summaries, transitions, attention,
      trackingState: { status: settings.tracking ? 'active' : 'paused', activeTabId: tabs.find(tab => tab.active)?.id, lastUpdatedAt: Date.now() }
    };
  }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return async function demoRequest(message) {
    try {
      let result;
      switch (message.type) {
        case 'GET_STATE': result = state(message.range); break;
        case 'PROPOSE_GROUPS':
          if (message.semantic) {
            model = {status: 'loading', name: model.name, progress: .45};
            await wait(750);
            model = {status: 'ready', name: model.name, progress: 1};
          }
          groups = makeGroups(Boolean(message.semantic));
          result = {groups, elapsedMs: message.semantic ? 750 : 12, method: message.semantic ? 'semantic' : 'rules', model};
          break;
        case 'APPLY_GROUP': {
          const ids = message.group.tabIds || [];
          const eligible = tabs.filter((tab) => ids.includes(tab.id) && tab.groupId < 0 && !tab.pinned);
          if (eligible.length < 2) throw new Error('该建议里已没有至少两个可分组的页面。');
          lastApply = eligible.map((tab) => ({id: tab.id, groupId: tab.groupId}));
          eligible.forEach((tab) => { tab.groupId = 99; });
          groups = makeGroups(false);
          result = {groupId: 99}; break;
        }
        case 'UNDO_GROUP':
          if (!lastApply) result = {restored: false};
          else { lastApply.forEach((entry) => { const tab = tabs.find((item) => item.id === entry.id); if (tab) tab.groupId = entry.groupId; }); lastApply = null; result = {restored: true}; }
          break;
        case 'SAVE_TASK': {
          const selectedPages = message.group ? message.group.pages.map((page) => ({pageId: page.id || page.pageId, title: page.title, url: page.url, tags: page.tags || []})) : tabs.filter((tab) => (message.tabIds || []).includes(tab.id)).map((tab) => ({pageId: tab.pageId, title: tab.title, url: tab.url, tags: tab.tags || []}));
          if (!selectedPages.length) throw new Error('请先选择要保存的页面。');
          if (selectedPages.length > 30) throw new Error('每个任务最多保存 30 页。');
          const task = {id: 'demo-task-' + Date.now(), name: message.name, notes: message.notes || '', pages: selectedPages.slice(0, 30), color: message.group?.color || 'green', locked: true, createdAt: Date.now(), updatedAt: Date.now()};
          tasks.unshift(task); result = task; break;
        }
        case 'UPDATE_TASK': {
          const task = tasks.find((item) => item.id === message.id);
          if (!task) throw new Error('找不到这个任务。');
          if ('name' in message) task.name = message.name;
          if ('notes' in message) task.notes = message.notes;
          task.updatedAt = Date.now(); result = task; break;
        }
        case 'DELETE_TASK': tasks = tasks.filter((task) => task.id !== message.id); result = {deleted: true}; break;
        case 'RESTORE_TASK': {
          const task = tasks.find((item) => item.id === message.id);
          if (!task) throw new Error('找不到这个任务。');
          let reused = 0, opened = 0;
          for (const page of task.pages.slice(0, 30)) {
            if (tabs.some((tab) => tab.url === page.url)) reused++;
            else { tabs.push({id: nextTabId++, pageId: page.pageId, title: page.title, url: page.url, domain: new URL(page.url).hostname, tags: page.tags, foregroundMs: 0, pinned: false, groupId: -1, windowId: 1}); opened++; }
          }
          task.lastRestoredAt = Date.now();
          const active = tabs.find(tab => task.pages.some(page => page.url === tab.url));
          if (active) tabs.forEach(tab => { tab.active = tab.id === active.id; });
          result = {opened, reused, failed: []}; break;
        }
        case 'FOCUS_TAB':
          if (!tabs.some((tab) => tab.id === message.tabId)) throw new Error('页面已关闭。');
          tabs.forEach((tab) => { tab.active = tab.id === message.tabId; });
          result = {focused: true}; break;
        case 'OPEN_PAGE': result = {opened: true}; break;
        case 'UPDATE_SETTINGS': settings = {...settings, ...message.patch}; result = settings; break;
        case 'FLUSH_ACTIVITY': result = {saved: true}; break;
        case 'EXPORT_DATA': result = {schemaVersion: 2, demo: true, exportedAt: Date.now(), pages, tasks, segments, settings}; break;
        case 'CLEAR_HISTORY':
          segments = []; tabs.forEach((tab) => { tab.foregroundMs = 0; }); result = {cleared: true}; break;
        case 'CLEAR_ALL':
          segments = []; tasks = []; groups = []; tabs.forEach((tab) => { tab.foregroundMs = 0; });
          settings = {tracking: true, semantic: true, idleSeconds: 120, retentionDays: 30, excludedDomains: []};
          result = {cleared: true}; break;
        case 'MODEL_WARMUP':
          model = {status: 'loading', name: model.name, progress: .3};
          await wait(750);
          model = {status: 'ready', name: model.name, progress: 1};
          result = {status: 'ready'}; break;
        default: throw new Error('未知示例操作：' + message.type);
      }
      return {ok: true, data: structuredClone(result)};
    } catch (error) {
      return {ok: false, error: error.message};
    }
  };
}
