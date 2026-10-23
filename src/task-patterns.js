import { mergeSegmentSnapshots } from './analytics.js';

const BARRIERS = new Set(['focus-lost', 'paused', 'clock-gap', 'restart-gap', 'restarted', 'clock-regression', 'idle', 'locked']);

export function taskPatterns(segments = [], tasks = [], events = [], now = Date.now()) {
  const known = new Map(tasks.map(task => [task.id, task]));
  const rows = mergeSegmentSnapshots(segments, now);
  const transfers = [], returns = [], episodes = new Set();
  let previous = null, episode = 0, lastAt = null, session = null, sameTaskSwitches = 0;
  let run = [];
  for (const segment of rows) {
    const separated = lastAt !== null && segment.startedAt - lastAt >= 900000;
    if (session !== segment.sessionId || separated) { episode++; previous = null; run = []; }
    session = segment.sessionId; lastAt = segment.endedAt;
    if (segment.status !== 'active' || segment.foregroundMs < 1000 || !known.has(segment.taskId)) { previous = null; run = []; episode++; continue; }
    const episodeId = `${session}:${episode}`;
    episodes.add(episodeId);
    if (previous && !BARRIERS.has(previous.endReason) && segment.startedAt >= previous.endedAt && segment.startedAt - previous.endedAt <= 90000) {
      if (previous.taskId === segment.taskId) {
        if (previous.pageId !== segment.pageId) sameTaskSwitches++;
        if (run.length) run[run.length - 1] = { ...run.at(-1), last: segment };
      } else {
        const edge = { from: previous.taskId, to: segment.taskId, at: segment.startedAt, episodeId, fromPage: previous, toPage: segment };
        transfers.push(edge);
        run.push({ taskId: segment.taskId, first: segment, last: segment });
        if (run.length > 3) run.shift();
        if (run.length === 3 && run[0].taskId === run[2].taskId) returns.push({ taskId: run[0].taskId, via: run[1].taskId, episodeId,
          leftAt: run[0].last.endedAt, returnedAt: segment.startedAt, intervalMs: segment.startedAt - run[0].last.endedAt,
          evidence: [run[0].last, run[1].first, segment] });
      }
    } else run = [{ taskId: segment.taskId, first: segment, last: segment }];
    previous = BARRIERS.has(segment.endReason) ? null : segment;
    if (!previous) { run = []; episode++; }
  }
  const grouped = new Map();
  for (const item of returns) {
    const key = `${item.taskId}|${item.via}`;
    if (!grouped.has(key)) grouped.set(key, { id: key, taskId: item.taskId, via: item.via, count: 0, episodes: new Set(), intervals: [], evidence: [] });
    const group = grouped.get(key); group.count++; group.episodes.add(item.episodeId); group.intervals.push(item.intervalMs); group.evidence.push(item);
  }
  const repeatedReturns = [...grouped.values()].filter(item => item.episodes.size >= 3).map(item => ({ ...item, sessions: item.episodes.size, episodes: undefined,
    meanIntervalMs: Math.round(item.intervals.reduce((sum, value) => sum + value, 0) / item.count), intervals: undefined,
    evidence: item.evidence.slice(-12), evidenceTotal: item.evidence.length }));
  const finds = new Map();
  for (const event of events.filter(item => item.kind === 'search-open' && item.at <= now)) {
    const value = finds.get(event.pageId) || { pageId: event.pageId, title: event.title, url: event.url, count: 0, days: new Set(), evidence: [] };
    value.count++; value.days.add(new Date(event.at).toDateString()); value.evidence.push(event); finds.set(event.pageId, value);
  }
  return { sameTaskSwitches, taskSwitches: transfers.length, observedReturns: returns.length, observedEpisodes: episodes.size,
    repeatedReturns, transitions: transfers.slice(-30), transitionsTotal: transfers.length,
    repeatedFinds: [...finds.values()].filter(item => item.days.size >= 3).map(item => ({ ...item, days: item.days.size, evidence: item.evidence.slice(-12), evidenceTotal: item.evidence.length })),
    restoreActions: events.filter(item => item.kind === 'restore').length };
}
