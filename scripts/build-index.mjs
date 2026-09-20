// build-index.mjs — embed the corpus and persist the vector index.
//
// Usage:
//   node scripts/build-index.mjs          # uses local transformers.js model
//   EMBEDDER=hash node scripts/build-index.mjs   # deterministic, no downloads
//
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VectorIndex } from '../src/retrieval.mjs';
import { makeLocalEmbedder, makeHashEmbedder } from '../src/embedder.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

async function main() {
  const useHash = process.env.EMBEDDER === 'hash';
  const embedder = useHash ? makeHashEmbedder() : await makeLocalEmbedder();
  console.error(`[build-index] embedder: ${useHash ? 'hash (deterministic)' : 'local transformers.js'}`);

  const corpus = JSON.parse(await readFile(join(root, 'data', 'corpus.json'), 'utf8'));
  const index = new VectorIndex(embedder);
  const n = await index.addDocuments(corpus);
  const outPath = join(root, 'data', 'index.json');
  await index.save(outPath);
  console.error(`[build-index] embedded ${n} chunks from ${corpus.length} docs -> ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
