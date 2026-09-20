// embedder.mjs
// An embedder is: (texts: string[]) => Promise<number[][]>
//
// Two implementations, same interface:
//
//   makeLocalEmbedder()  -> real semantic embeddings via @huggingface/transformers
//                           (all-MiniLM-L6-v2, 384-dim). Runs fully local, no API key,
//                           no server. THIS IS THE ONE YOU USE ON YOUR MACHINE.
//
//   makeHashEmbedder()   -> deterministic bag-of-words hashing embedding, zero deps,
//                           zero downloads. Not semantic, but real vectors — used to
//                           prove the pipeline end-to-end in restricted environments
//                           and in unit tests.
//
// Swapping is one line in build-index.mjs / server.mjs. Everything downstream
// (chunking, cosine search, MCP tool) is identical regardless of which you pick.

// ---------- real local embeddings ----------

export async function makeLocalEmbedder(model = 'Xenova/all-MiniLM-L6-v2') {
  // Dynamic import so environments without the native onnxruntime binary can still
  // load this module and use the hash embedder instead.
  const { pipeline } = await import('@huggingface/transformers');
  const extractor = await pipeline('feature-extraction', model);
  return async function embed(texts) {
    const out = [];
    for (const text of texts) {
      // mean-pooled, L2-normalised sentence embedding
      const tensor = await extractor(text, { pooling: 'mean', normalize: true });
      out.push(Array.from(tensor.data));
    }
    return out;
  };
}

// ---------- deterministic fallback ----------

/**
 * Hashing embedder: maps each token to a bucket via a stable hash, accumulates
 * counts, then L2-normalises. Deterministic and dependency-free. Good enough to
 * exercise and TEST the full retrieval + MCP + agent loop; NOT a semantic model.
 * @param {number} dim
 */
export function makeHashEmbedder(dim = 384) {
  const hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  return async function embed(texts) {
    return texts.map((text) => {
      const vec = new Array(dim).fill(0);
      const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];
      for (const tok of tokens) {
        vec[hash(tok) % dim] += 1;
      }
      let norm = 0;
      for (const v of vec) norm += v * v;
      norm = Math.sqrt(norm) || 1;
      return vec.map((v) => v / norm);
    });
  };
}
