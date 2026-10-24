import test from 'node:test';
import assert from 'node:assert/strict';
import {transitionTask, statusOf} from '../src/task-lifecycle.js';
import {taskFrom} from '../src/store.js';
test('legacy task state defaults to active and preserves long Unicode notes', () => {
  const notes='资料🙂\n'.repeat(1000), task=taskFrom({id:'a', name:'任务', notes,pages:[]});
  assert.equal(statusOf(task),'active'); assert.equal(task.notes,notes); assert.equal(task.completedAt,null);
});
test('completion releases every matching window atomically without changing other intent or text', () => {
  const task=taskFrom({id:'a',name:'A',notes:'保留',pages:[]}), context={sessionId:'s',windows:{1:{taskId:'a',revision:2},2:{taskId:'a',revision:4},3:{taskId:'b',revision:1}}};
  const changed=transitionTask(task,'completed',context,123);
  assert.equal(changed.task.completedAt,123); assert.equal(changed.task.notes,'保留');
  assert.equal(changed.context.windows[1].taskId,null); assert.equal(changed.context.windows[2].revision,5); assert.equal(changed.context.windows[3].taskId,'b');
  assert.equal(context.windows[1].taskId,'a');
  assert.equal(transitionTask(changed.task,'active',changed.context,456).task.completedAt,null);
  assert.throws(()=>transitionTask(task,'invented',context),{code:'INVALID_TASK_STATUS'});
});
