// test-retrieval.mjs — unit tests for the retrieval core. Run: node scripts/test-retrieval.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, cosineSimilarity, VectorIndex } from '../src/retrieval.mjs';
import { makeHashEmbedder } from '../src/embedder.mjs';

test('chunkText produces overlapping chunks that cover all words', () => {
  const words = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ');
  const chunks = chunkText(words, 180, 40);
  assert.ok(chunks.length >= 2, 'should split 400 words into multiple chunks');
  assert.ok(chunks[0].split(' ').length <= 180);
  // overlap: last 40 words of chunk 0 should reappear at the start of chunk 1
  const c0 = chunks[0].split(' ');
  const c1 = chunks[1].split(' ');
  assert.equal(c0[c0.length - 1], c1[39]);
});

test('chunkText handles empty and short input', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('one two three'), ['one two three']);
});

test('cosineSimilarity: identical vectors = 1, orthogonal = 0', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-9);
});

test('VectorIndex ranks the relevant chunk first', async () => {
  const idx = new VectorIndex(makeHashEmbedder());
  await idx.addDocuments([
    { source: 'a', text: 'cats are small domestic feline animals that purr' },
    { source: 'b', text: 'the stock market closed higher on strong earnings' },
  ]);
  const hits = await idx.search('tell me about pet cats and felines', 2);
  assert.equal(hits[0].source, 'a', 'the cat document should rank first');
  assert.ok(hits[0].score >= hits[1].score);
});
