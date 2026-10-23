import { stableHash } from './text.js';
import { failure } from './task-context.js';

export const MEMORY_MODEL = 'bge-small-zh-v1.5@75c43b0:q8:cls:128:v1';
export const QUERY_INSTRUCTION = '为这个句子生成表示以用于检索相关文章：';

export function semanticItem(id, text, purpose = 'document') {
  const content = String(text || '').trim();
  return { id: `mem:${purpose}:${id}`, text: content, textHash: stableHash(`${purpose}:${content}`) };
}

/** Shared, bounded embedding cache; callers control candidate eligibility. */
export async function embedItems(items, { store, infer, isCurrent = () => true, cache = true, batchSize = 24 }) {
  if (!isCurrent()) throw failure('CANCELLED', '本机分析已取消。');
  const unique = [...new Map(items.filter(item => item.text).map(item => [item.id, item])).values()];
  const saved = cache ? await store.getVectors(unique.map(item => item.id)) : [];
  const records = new Map(saved.map(item => [item.id, item]));
  const vectors = new Map(), missing = [];
  for (const item of unique) {
    const found = records.get(item.id);
    if (found?.model === MEMORY_MODEL && found.textHash === item.textHash && found.vector?.length === 512 && found.vector.every(Number.isFinite)) vectors.set(item.id, found.vector);
    else missing.push(item);
  }
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    if (!isCurrent()) throw failure('CANCELLED', '本机分析已取消。');
    const batch = missing.slice(offset, offset + batchSize);
    const result = await infer(batch.map(({id, text}) => ({id, text})));
    if (!isCurrent()) throw failure('CANCELLED', '本机分析已取消。');
    const returned = new Map((result.vectors || []).map(item => [item.id, item.vector]));
    if (batch.some(item => !Array.isArray(returned.get(item.id)) || returned.get(item.id).length !== 512 || returned.get(item.id).some(value => !Number.isFinite(value)))) throw new Error('本机模型没有返回完整的有效结果。');
    const additions = batch.map(item => ({ id: item.id, model: MEMORY_MODEL, textHash: item.textHash, vector: returned.get(item.id), updatedAt: Date.now() }));
    if (cache) await store.putVectors(additions);
    // A clear may have run while the cache transaction was pending.
    if (!isCurrent()) throw failure('CANCELLED', '本机分析已取消。');
    for (const item of additions) vectors.set(item.id, item.vector);
  }
  return { vectors, computed: missing.length, cached: unique.length - missing.length };
}

export function textChunks(value, length = 110, overlap = 16) {
  const chars = [...String(value || '').trim()];
  const chunks = [];
  for (let index = 0; index < chars.length; index += length - overlap) chunks.push(chars.slice(index, index + length).join(''));
  return chunks;
}
