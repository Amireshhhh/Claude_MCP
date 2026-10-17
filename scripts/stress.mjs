// stress.mjs — load-test the MCP server through the real protocol.
//
// Every call is a JSON-RPC round trip over stdio to a server subprocess
// (client -> stdio -> server -> tool -> back), not a direct function call.
//
//   node scripts/stress.mjs [tool] [totalCalls] [concurrency]
//   npm run stress -- search_docs 1000 20
//   npm run stress -- get_doc 1000 50
//
// Uses the same EMBEDDER setting as the server (hash by default). The index in
// data/index.json must have been built with the same embedder.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tool = process.argv[2] ?? 'search_docs';
const total = Number(process.argv[3] ?? 500);
const concurrency = Number(process.argv[4] ?? 20);

const sources = JSON.parse(await readFile(join(root, 'data', 'corpus.json'), 'utf8')).map((d) => d.source);
const queries = ['how does the agentic loop work', 'what is MCP', 'cosine similarity in vector search',
  'tool_use and tool_result blocks', 'remote MCP servers in the API', 'how are documents chunked'];
const argsFor = (i) => tool === 'get_doc'
  ? { source: sources[i % sources.length] }
  : { query: queries[i % queries.length], k: 3 };

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'src', 'server.mjs')],
  env: { ...process.env, EMBEDDER: process.env.EMBEDDER ?? 'hash' },
});
const client = new Client({ name: 'stress', version: '1.0.0' });
await client.connect(transport);

const latencies = [];
let errors = 0, next = 0;
const worker = async () => {
  for (let i = next++; i < total; i = next++) {
    const t0 = performance.now();
    try {
      const res = await client.callTool({ name: tool, arguments: argsFor(i) });
      if (res.isError) errors++;
    } catch {
      errors++;
    }
    latencies.push(performance.now() - t0);
  }
};

const start = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const wall = performance.now() - start;
await client.close();

latencies.sort((a, b) => a - b);
const mean = latencies.reduce((s, x) => s + x, 0) / latencies.length;
console.log(`tool=${tool} calls=${latencies.length} errors=${errors} concurrency=${concurrency} embedder=${process.env.EMBEDDER ?? 'hash'}`);
console.log(`throughput  ${(latencies.length / (wall / 1000)).toFixed(0)} calls/s   (wall ${wall.toFixed(0)} ms)`);
console.log(`latency ms  mean ${mean.toFixed(2)}  p50 ${pct(latencies, 50).toFixed(2)}  p95 ${pct(latencies, 95).toFixed(2)}  p99 ${pct(latencies, 99).toFixed(2)}  max ${latencies.at(-1).toFixed(2)}`);
if (errors) process.exitCode = 1;
