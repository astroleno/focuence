/** User intent and confirmed membership are separate, immutable observations. */
export const TASK_LIMITS = Object.freeze({ name: 120, goal: 1000, notes: 20000, progress: 2000, blocker: 2000, nextStep: 2000, pages: 30 });

export function failure(code, message) { return Object.assign(new Error(message), { code }); }

export function assertRevision(task, expected) {
  if (!task) throw failure('TASK_NOT_FOUND', '这个任务已经不存在。');
  if (!Number.isInteger(expected) || expected !== (task.revision || 0)) {
    throw failure('STALE_TASK', '任务已在其他入口更新。请重新读取后核对；你的草稿仍然保留。');
  }
  return task;
}

export function taskText(value, field, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw failure('INVALID_TASK', '请填写任务名称。');
  if ([...text].length > TASK_LIMITS[field]) throw failure('INVALID_TASK', `内容过长，最多 ${TASK_LIMITS[field]} 个字符。`);
  return text;
}

export function relationId(taskId, pageId) { return `${taskId}|${pageId}`; }

export function relationFor(task, pageId, relations = []) {
  const explicit = relations.find(item => item.taskId === task.id && item.pageId === pageId);
  if (explicit) return { related: explicit.decision === 'related', source: explicit.decision === 'related' ? 'confirmed' : 'excluded', relation: explicit };
  if (task.pages?.some(page => (page.pageId || page.id) === pageId)) return { related: true, source: 'saved', relation: null };
  return { related: false, source: 'unknown', relation: null };
}

export function resolveTaskContext(pageId, intendedTaskId, tasks = [], relations = []) {
  const intended = tasks.find(task => task.id === intendedTaskId);
  const membership = tasks.map(task => ({ task, ...relationFor(task, pageId, relations) }));
  const current = membership.find(item => item.task.id === intended?.id);
  const matches = membership.filter(item => item.related);
  const selected = current?.related ? current : matches.length === 1 ? matches[0] : null;
  return {
    intendedTaskId: intended?.id || null,
    taskId: selected?.task.id || null,
    assignmentSource: selected?.source || (current?.source === 'excluded' ? 'excluded' : 'unknown'),
    excludedFromIntent: current?.source === 'excluded',
  };
}

export function normalizeWorkContext(value, sessionId) {
  if (value?.sessionId !== sessionId) return { sessionId, windows: {} };
  return { sessionId, windows: { ...(value.windows || {}) } };
}

export function windowContext(context, windowId) {
  return context?.windows?.[windowId] || { taskId: null, revision: 0, startedAt: 0 };
}

export function changeWindowContext(context, windowId, taskId, expectedRevision, now) {
  const current = windowContext(context, windowId);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) throw failure('STALE_CONTEXT', '这个窗口的当前任务已改变，请重新读取后再操作。');
  return { ...context, windows: { ...context.windows, [windowId]: { taskId: taskId || null, revision: current.revision + 1, startedAt: taskId ? now : 0 } } };
}
