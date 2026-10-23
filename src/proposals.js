import {normalizeUrl, pageFromTab} from './text.js';

export const STALE_PROPOSAL = '页面已经变化，这条建议已撤回。请重新生成建议。';

export function sealProposal(group, tabs, revision = crypto.randomUUID()) {
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  return {...group, revision, snapshot: group.tabIds.map(id => {
    const tab = byId.get(id), page = pageFromTab(tab);
    return {id, windowId: tab.windowId, url: page.url, title: page.title};
  })};
}

export function proposalIsCurrent(group, tabs, windowId) {
  if (!group?.revision || group.windowId !== windowId || !Array.isArray(group.snapshot) ||
      !Array.isArray(group.tabIds) || group.tabIds.length < 2 || group.snapshot.length !== group.tabIds.length) return false;
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  const ids = new Set(group.tabIds);
  if (ids.size !== group.tabIds.length) return false;
  return group.snapshot.every(saved => {
    const tab = byId.get(saved.id), page = pageFromTab(tab);
    return ids.has(saved.id) && tab && page && !tab.pinned && Number(tab.groupId) < 0 &&
      tab.windowId === windowId && saved.windowId === windowId &&
      page.url === saved.url && page.title === saved.title &&
      (!tab.pendingUrl || normalizeUrl(tab.pendingUrl) === saved.url);
  });
}

// Only a background-owned proposal can authorize a mutation. Client pages,
// names, colors and snapshots are never used to expand or redefine its scope.
export function validateProposalSelection(proposal, request, tabs, windowId) {
  if (!proposalIsCurrent(proposal, tabs, windowId) || request?.id !== proposal.id ||
      request.revision !== proposal.revision || request.windowId !== windowId) {
    throw Object.assign(new Error(STALE_PROPOSAL), {code: 'STALE_PROPOSAL'});
  }
  const ids = request.tabIds;
  if (!Array.isArray(ids) || ids.length < 2 || new Set(ids).size !== ids.length ||
      ids.some(id => !Number.isInteger(id) || !proposal.tabIds.includes(id))) {
    throw new Error('请在当前建议中选择至少两个不同的页面。');
  }
  const selected = new Set(ids);
  return tabs.filter(tab => selected.has(tab.id));
}

export function proposalMembers(group, tabs, selections) {
  const available = new Set(tabs.filter(tab => tab.windowId === group.windowId && !tab.pinned && Number(tab.groupId) < 0).map(tab => tab.id));
  const key = group.id + ':' + group.revision;
  if (!selections.has(key)) selections.set(key, new Set(group.tabIds));
  const selected = selections.get(key);
  for (const id of selected) if (!available.has(id) || !group.tabIds.includes(id)) selected.delete(id);
  return selected;
}

export function selectedProposal(group, tabs, selections) {
  const selected = proposalMembers(group, tabs, selections);
  const members = tabs.filter(tab => selected.has(tab.id));
  const urls = new Set(members.map(tab => normalizeUrl(tab.url)));
  return {...group, tabIds: group.tabIds.filter(id => selected.has(id)), pages: group.pages.filter(page => urls.has(normalizeUrl(page.url)))};
}
