import { failure } from './task-context.js';

export const TASK_STATUSES = Object.freeze({active: '进行中', waiting: '等待', completed: '已完成', archived: '已归档'});
export function statusOf(task) { return Object.hasOwn(TASK_STATUSES, task?.status) ? task.status : 'active'; }
export function transitionTask(task, status, context, at = Date.now()) {
  if (!Object.hasOwn(TASK_STATUSES, status)) throw failure('INVALID_TASK_STATUS', '请选择有效的任务状态。');
  const next = structuredClone(context);
  if (status !== 'active') for (const [id, current] of Object.entries(next?.windows || {})) {
    if (current.taskId === task.id) next.windows[id] = {taskId: null, revision: current.revision + 1, startedAt: 0};
  }
  return {task: {...task, status, statusChangedAt: at, completedAt: status === 'completed' ? at : null,
    revision: task.revision + 1, updatedAt: at}, context: next};
}
