import { normalizeUrl, pageIdForUrl, stableHash } from './text.js';
import { failure, TASK_LIMITS } from './task-context.js';

export const BACKUP_VERSION = 4;
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const ordered = values => [...(values || [])].sort((a,b) => String(a.id).localeCompare(String(b.id)));
export function backupStamp(data, full = false) {
  return stableHash(canonical({tasks: ordered(data.tasks), taskRelations: ordered(data.taskRelations), settings: data.settings,
    ...(full ? {pages: ordered(data.pages), segments: ordered(data.segments)} : {})}));
}

/** Validate all records before asking the persistence layer to write anything. */
export function decodeBackup(input, normalizers) {
  let raw;
  try { raw = typeof input === 'string' ? JSON.parse(input) : structuredClone(input); }
  catch { throw failure('IMPORT_INVALID', '文件不是有效的 JSON；本机数据未改变。'); }
  if (!raw || ![2,3,4].includes(raw.schemaVersion)) throw failure('IMPORT_VERSION', '备份版本不受支持。请使用格式 2—4 的 Focuence 备份。');
  const issues = [], issue = (path, message) => issues.push(path + '：' + message);
  const id = (value, path) => {
    if (typeof value !== 'string' || !value || value.length > 500 || ['__proto__','prototype','constructor'].includes(value) || /[\u0000-\u001f]/.test(value)) issue(path, '缺少有效标识');
  };
  const text = (value, path, max) => { if (value != null && (typeof value !== 'string' || [...value].length > max)) issue(path, '文字类型无效或超过 ' + max + ' 字'); };
  const time = (value, path) => { if (value != null && (!Number.isFinite(value) || value < 0)) issue(path, '时间无效'); };
  const url = (value, path) => {
    try { const parsed = new URL(value); if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); }
    catch { issue(path, '只接受无用户名密码的 HTTP(S) 地址'); }
    return normalizeUrl(value);
  };
  const list = key => {
    if (!Array.isArray(raw[key]) && !(key === 'taskRelations' && raw.schemaVersion === 2)) issue(key, '应为列表');
    return Array.isArray(raw[key]) ? raw[key] : [];
  };
  const recordList = (key, normalize) => {
    const found = new Map();
    list(key).forEach((value, index) => {
      const path = key + '[' + index + ']';
      if (!value || typeof value !== 'object' || Array.isArray(value)) { issue(path, '应为记录'); return; }
      id(value.id, path + '.id');
      let result;
      try { result = normalize(value, path); } catch (error) { issue(path, error.message); return; }
      if (!result) { issue(path, '记录无效'); return; }
      const old = found.get(result.id);
      if (old && canonical(old) !== canonical(result)) issue(path, '标识重复但内容不同');
      else found.set(result.id, result);
    });
    return [...found.values()];
  };
  const page = (value, path) => {
    const cleaned = url(value.url, path + '.url'); text(value.title, path + '.title', 500);
    time(value.lastSeen,path + '.lastSeen');
    if (value.tags != null && (!Array.isArray(value.tags) || value.tags.length > 8 || value.tags.some(tag => typeof tag !== 'string' || [...tag].length > 60))) issue(path + '.tags', '标签无效');
    return {...value, id: pageIdForUrl(cleaned), pageId: pageIdForUrl(cleaned), url: cleaned};
  };
  const pages = recordList('pages', (value,path) => normalizers.pageFrom(page(value,path)));
  const tasks = recordList('tasks', (value,path) => {
    for (const field of ['name','goal','notes']) text(value[field], path + '.' + field, TASK_LIMITS[field]);
    if (!value.name?.trim()) issue(path + '.name', '名称不能为空');
    if (value.status != null && !['active','waiting','completed','archived'].includes(value.status)) issue(path + '.status', '任务状态无效');
    for (const field of ['createdAt','updatedAt','lastRestoredAt','statusChangedAt','completedAt']) time(value[field], path + '.' + field);
    if (!Array.isArray(value.pages) || value.pages.length > 30) issue(path + '.pages', '恢复清单应为最多 30 页的列表');
    const members = (Array.isArray(value.pages) ? value.pages : []).map((item,index) => page(item,path + '.pages[' + index + ']'));
    if (value.checkpoint) {
      if (value.checkpoint.source !== 'confirmed') issue(path + '.checkpoint', '断点须为已确认记录');
      for (const field of ['progress','blocker','nextStep']) text(value.checkpoint[field], path + '.checkpoint.' + field, TASK_LIMITS[field]);
      if (value.checkpoint.page) page(value.checkpoint.page,path + '.checkpoint.page');
      for (const field of ['at','confirmedAt']) time(value.checkpoint[field],path + '.checkpoint.' + field);
    }
    return normalizers.taskFrom({...value, createdAt: value.createdAt ?? 0, updatedAt: value.updatedAt ?? 0, pages: members});
  });
  const taskIds = new Set(tasks.map(task => task.id));
  const taskRelations = recordList('taskRelations', (value,path) => {
    if (!taskIds.has(value.taskId)) issue(path + '.taskId', '关联引用的任务不存在');
    return normalizers.relationFrom({...value, page: page(value.page || {},path + '.page')});
  });
  const segments = recordList('segments', (value,path) => {
    const cleaned = url(value.url,path + '.url');
    for (const field of ['startedAt','endedAt','foregroundMs']) time(value[field],path + '.' + field);
    if (!Number.isFinite(value.startedAt) || !Number.isFinite(value.endedAt) || value.endedAt < value.startedAt
      || !Number.isFinite(value.foregroundMs) || value.foregroundMs > value.endedAt-value.startedAt || !['active','idle','unknown'].includes(value.status)
      || (value.status !== 'active' && value.foregroundMs > 0)) issue(path, '访问状态、时间或时长不一致');
    return normalizers.segmentFrom({...value, url: cleaned, pageId: pageIdForUrl(cleaned)});
  });
  if (!raw.settings || typeof raw.settings !== 'object' || Array.isArray(raw.settings)) issue('settings', '设置无效');
  for (const key of ['tracking','semantic','focusSupport']) if (raw.settings?.[key] != null && typeof raw.settings[key] !== 'boolean') issue('settings.' + key, '应为开关');
  for (const [key,min,max] of [['idleSeconds',15,3600],['retentionDays',1,365]]) if (raw.settings?.[key] != null && (!Number.isFinite(raw.settings[key]) || raw.settings[key] < min || raw.settings[key] > max)) issue('settings.' + key, '超出支持范围');
  if (raw.settings?.excludedDomains != null && (!Array.isArray(raw.settings.excludedDomains) || raw.settings.excludedDomains.length>500 || raw.settings.excludedDomains.some(value => typeof value !== 'string'))) issue('settings.excludedDomains','站点列表无效');
  if (issues.length) throw Object.assign(failure('IMPORT_INVALID', '备份校验未通过：' + issues.slice(0,8).join('；') + (issues.length>8 ? '；另有 ' + (issues.length-8) + ' 项错误' : '')), {issues});
  return {schemaVersion: raw.schemaVersion, pages, tasks, taskRelations, segments, settings: normalizers.settingsFrom(raw.settings)};
}

export function planImport(incoming, current, {mode = 'merge', choices = {}, adoptSettings = false} = {}) {
  if (!['merge','replace'].includes(mode)) throw failure('IMPORT_INVALID', '请选择合并或整体恢复。');
  const localTasks = new Map(current.tasks.map(task => [task.id,task]));
  const conflicts = incoming.tasks.filter(task => localTasks.has(task.id) && canonical(task) !== canonical(localTasks.get(task.id)))
    .map(task => ({id: task.id, name: task.name, localName: localTasks.get(task.id).name, choice: choices[task.id] === 'backup' ? 'backup' : 'local'}));
  const selected = incoming.tasks.filter(task => mode === 'replace' || !localTasks.has(task.id) || choices[task.id] === 'backup');
  const selectedIds = new Set(selected.map(task => task.id));
  const tasks = mode === 'replace' ? selected : [...current.tasks.filter(task => !selectedIds.has(task.id)), ...selected];
  const relations = mode === 'replace' ? incoming.taskRelations : [...current.taskRelations.filter(item => !selectedIds.has(item.taskId)),
    ...incoming.taskRelations.filter(item => selectedIds.has(item.taskId))];
  const oldSegments = new Map(current.segments.map(item => [item.id,item]));
  if (mode === 'merge') for (const segment of incoming.segments) {
    if (oldSegments.has(segment.id) && canonical(oldSegments.get(segment.id)) !== canonical(segment)) throw failure('IMPORT_CONFLICT', '访问记录 ' + segment.id + ' 的标识相同但内容不同，不能合并；请核对文件。');
  }
  const segments = mode === 'replace' ? incoming.segments : incoming.segments.filter(item => !oldSegments.has(item.id));
  const oldPages = new Set(current.pages.map(item => item.id));
  return {mode, adoptSettings, baseStamp: backupStamp(current, mode === 'replace'), conflicts,
    data: {tasks: tasks.map(task => ({...task, revision: Math.max(task.revision || 0,localTasks.get(task.id)?.revision || 0)+1})), taskRelations: relations,
      pages: mode === 'replace' ? incoming.pages : incoming.pages.filter(item => !oldPages.has(item.id)), segments, settings: incoming.settings},
    resetRelations: mode === 'replace' ? [] : [...selectedIds],
    counts: {tasks: incoming.tasks.length, relations: incoming.taskRelations.length, pages: incoming.pages.length, segments: incoming.segments.length,
      newTasks: incoming.tasks.filter(task => !localTasks.has(task.id)).length, taskConflicts: conflicts.length,
      duplicateSegments: incoming.segments.length-segments.length, removedTasks: mode === 'replace' ? current.tasks.filter(task => !incoming.tasks.some(item => item.id === task.id)).length : 0,
      removedSegments: mode === 'replace' ? current.segments.filter(item => !incoming.segments.some(row => row.id === item.id)).length : 0}};
}
