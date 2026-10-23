import test from 'node:test';
import assert from 'node:assert/strict';
import {sealProposal, proposalIsCurrent, validateProposalSelection, proposalMembers, selectedProposal} from '../src/proposals.js';

function fixture() {
  const tabs = [1, 2, 3, 4].map(id => ({id, windowId: 7, url: 'https://example.org/esp32/' + id, title: 'ESP32 参考 ' + id, pinned: false, groupId: -1, index: id - 1}));
  const group = sealProposal({id: 'esp32', windowId: 7, name: 'ESP32', color: 'blue', tabIds: [1, 2, 3, 4], pages: tabs.map(tab => ({title: tab.title, url: tab.url}))}, tabs, 'revision-a');
  return {tabs, group};
}
const stale = error => error.code === 'STALE_PROPOSAL';

test('applying requires the original window even when every member moved together', () => {
  const {tabs, group} = fixture();
  for (const tab of tabs) tab.windowId = 8;
  assert.equal(proposalIsCurrent(group, tabs, 7), false);
  assert.equal(proposalIsCurrent(group, tabs, 8), false);
  assert.throws(() => validateProposalSelection(group, {...group, pages: []}, tabs, 7), stale);
  assert.throws(() => validateProposalSelection(group, {...group, windowId: 8}, tabs, 8), stale);
});

test('closing a member invalidates the whole consent rather than silently applying fewer tabs', () => {
  const {tabs, group} = fixture();
  tabs.pop();
  assert.throws(() => validateProposalSelection(group, group, tabs, 7), stale);
  // Even if the missing member was unchecked, the displayed proposal changed.
  assert.throws(() => validateProposalSelection(group, {...group, tabIds: [1, 2]}, tabs, 7), stale);
});

test('title, URL, pending navigation, pinning, grouping and incognito changes each invalidate a proposal', () => {
  for (const patch of [{title: '烘焙配方'}, {url: 'https://example.org/baking'}, {pendingUrl: 'https://example.org/baking'}, {pinned: true}, {groupId: 9}, {incognito: true}, {windowId: 8}]) {
    const {tabs, group} = fixture();
    Object.assign(tabs[0], patch);
    assert.equal(proposalIsCurrent(group, tabs, 7), false, JSON.stringify(patch));
  }
});

test('unchanged content tolerates tracking fragments, reordering and visit-time updates', () => {
  const {tabs, group} = fixture();
  Object.assign(tabs[0], {url: tabs[0].url + '?utm_source=x#heading', index: 10, lastAccessed: Date.now()});
  assert.equal(proposalIsCurrent(group, tabs, 7), true);
  assert.equal(proposalIsCurrent(group, [...tabs, {id: 5, windowId: 7}], 7), true);
});

test('legacy and superseded proposals cannot authorize mutations', () => {
  const {tabs, group} = fixture();
  assert.throws(() => validateProposalSelection({...group, snapshot: undefined}, group, tabs, 7), stale);
  assert.throws(() => validateProposalSelection(group, {...group, revision: 'revision-old'}, tabs, 7), stale);
  assert.throws(() => validateProposalSelection(undefined, group, tabs, 7), stale);
});

test('a valid subset applies exact IDs and ignores client-supplied metadata', () => {
  const {tabs, group} = fixture();
  const selected = validateProposalSelection(group, {...group, tabIds: [1, 3], name: 'Untrusted', pages: [], snapshot: []}, tabs, 7);
  assert.deepEqual(selected.map(tab => tab.id), [1, 3]);
  assert.equal(group.name, 'ESP32');
});

test('foreign, duplicate, single and nonnumeric IDs are rejected', () => {
  const {tabs, group} = fixture();
  for (const tabIds of [[1], [1, 1], [1, 8], ['1', 2], []]) {
    assert.throws(() => validateProposalSelection(group, {...group, tabIds}, tabs, 7), /至少两个不同/);
  }
});

test('one changed group does not invalidate an unrelated proposal', () => {
  const {tabs, group} = fixture();
  const other = sealProposal({...group, id: 'other', tabIds: [3, 4]}, tabs, 'other-revision');
  tabs[0].windowId = 8;
  assert.equal(proposalIsCurrent(group, tabs, 7), false);
  assert.equal(proposalIsCurrent(other, tabs, 7), true);
});

test('member correction survives refresh, prunes unavailable IDs and resets only with a new revision', () => {
  const {tabs, group} = fixture(), selections = new Map();
  const selected = proposalMembers(group, tabs, selections);
  selected.delete(2);
  assert.deepEqual([...proposalMembers(structuredClone(group), structuredClone(tabs), selections)], [1, 3, 4]);
  tabs[2].windowId = 8;
  assert.deepEqual([...proposalMembers(group, tabs, selections)], [1, 4]);
  assert.deepEqual([...proposalMembers({...group, revision: 'new'}, tabs, selections)], [1, 2, 4]);
});

test('selected task pages match selected live tab IDs without losing duplicate identity in the proposal', () => {
  const {tabs, group} = fixture(), selections = new Map();
  proposalMembers(group, tabs, selections).delete(2);
  const selected = selectedProposal(group, tabs, selections);
  assert.deepEqual(selected.tabIds, [1, 3, 4]);
  assert.equal(selected.pages.length, 3);
  assert.equal(selected.revision, group.revision);
  assert.equal(group.snapshot.length, 4);
});
