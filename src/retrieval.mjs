// retrieval.mjs
// In-process vector search over a document corpus.
//
// Design (defensible in an interview):
//   1. Split documents into overlapping chunks (fixed token-ish window by words).
//   2. Embed each chunk into a dense vector with a pluggable embedder.
//   3. Store {id, text, source, vector} in a flat in-memory index, persisted to JSON.
//   4. Query = embed the question, rank all chunks by cosine similarity, return top-k.
//
// For a docs-sized corpus (hundreds–thousands of chunks) exact cosine search is
// sub-millisecond, so we deliberately DON'T need an approximate-nearest-neighbour
// index. That's a conscious tradeoff, not an omission: exact search is simpler,
// has zero extra dependencies, and returns the true top-k every time.

import { readFile, writeFile } from 'node:fs/promises';

// ---------- chunking ----------

/**
 * Split text into overlapping word-window chunks.
 * @param {string} text
 * @param {number} windowWords  target words per chunk
 * @param {number} overlapWords words of overlap between consecutive chunks
 * @returns {string[]}
 */
export function chunkText(text, windowWords = 180, overlapWords = 40) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const step = Math.max(1, windowWords - overlapWords);
  const chunks = [];
  for (let start = 0; start < words.length; start += step) {
    const slice = words.slice(start, start + windowWords);
    if (slice.length === 0) break;
    chunks.push(slice.join(' '));
    if (start + windowWords >= words.length) break;
  }
  return chunks;
}

// ---------- similarity ----------

/** Cosine similarity between two equal-length numeric arrays. */
export function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------- index ----------

export class VectorIndex {
  /** @param {(texts: string[]) => Promise<number[][]>} embedder */
  constructor(embedder) {
    this.embedder = embedder;
    /** @type {{id:string,text:string,source:string,vector:number[]}[]} */
    this.records = [];
  }

  /**
   * Add documents. Each doc is {source, text}. Text is chunked, each chunk embedded.
   * @param {{source:string,text:string}[]} docs
   */
  async addDocuments(docs) {
    const pending = [];
    for (const doc of docs) {
      const chunks = chunkText(doc.text);
      chunks.forEach((chunk, i) => {
        pending.push({ id: `${doc.source}#${i}`, text: chunk, source: doc.source });
      });
    }
    const vectors = await this.embedder(pending.map((p) => p.text));
    pending.forEach((p, i) => {
      this.records.push({ ...p, vector: vectors[i] });
    });
    return pending.length;
  }

  /**
   * Return the top-k most similar chunks to the query.
   * @param {string} query
   * @param {number} k
   * @returns {Promise<{id:string,text:string,source:string,score:number}[]>}
   */
  async search(query, k = 3) {
    if (this.records.length === 0) return [];
    const [qVec] = await this.embedder([query]);
    const scored = this.records.map((r) => ({
      id: r.id,
      text: r.text,
      source: r.source,
      score: cosineSimilarity(qVec, r.vector),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  async save(path) {
    await writeFile(path, JSON.stringify({ records: this.records }, null, 0));
  }

  async load(path) {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    this.records = raw.records;
    return this.records.length;
  }
}
