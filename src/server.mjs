// server.mjs — an MCP server exposing retrieval tools over stdio.
//
// Built against @modelcontextprotocol/server v2 (2026-07-28 spec):
//   - McpServer            from '@modelcontextprotocol/server'
//   - serveStdio           from '@modelcontextprotocol/server/stdio'
//   - registerTool(name, { description, inputSchema }, handler)
//   - inputSchema is a Zod v4 object; the SDK validates every call against it
//     before the handler runs.
//
// Tools exposed:
//   search_docs(query, k)  -> top-k chunks by vector similarity, with sources
//   get_doc(source)        -> the full text of one source document
//
// Run standalone:   node src/server.mjs
// A host (Claude Desktop, or the API MCP connector via a bridge) launches this
// process, lists these two tools, and calls them.

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { VectorIndex } from './retrieval.mjs';
import { makeLocalEmbedder, makeHashEmbedder } from './embedder.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// ---- load corpus (raw text, for get_doc) and the prebuilt vector index ----
const corpus = JSON.parse(await readFile(join(root, 'data', 'corpus.json'), 'utf8'));
const corpusBySource = new Map(corpus.map((d) => [d.source, d.text]));

const embedder = process.env.EMBEDDER === 'hash'
  ? makeHashEmbedder()
  : await makeLocalEmbedder();

const index = new VectorIndex(embedder);
await index.load(join(root, 'data', 'index.json'));

// ---- build the server and register tools ----
serveStdio(() => {
  const server = new McpServer({ name: 'anthropic-docs', version: '1.0.0' });

  server.registerTool(
    'search_docs',
    {
      description:
        'Search the Anthropic documentation corpus by semantic similarity. ' +
        'Returns the top-k most relevant chunks, each with its source file and a similarity score. ' +
        'Use this to ground answers about MCP, tool use, and context engineering in the docs.',
      inputSchema: z.object({
        query: z.string().describe('The natural-language question to search for.'),
        k: z.number().int().min(1).max(10).default(3)
          .describe('How many chunks to return.'),
      }),
    },
    async ({ query, k }) => {
      const hits = await index.search(query, k);
      const text = hits
        .map((h, i) => `[${i + 1}] (${h.source}, score ${h.score.toFixed(3)})\n${h.text}`)
        .join('\n\n');
      return {
        content: [{ type: 'text', text: text || 'No results.' }],
      };
    },
  );

  server.registerTool(
    'get_doc',
    {
      description:
        'Return the full text of one source document by its filename ' +
        '(as reported in the source field of search_docs results).',
      inputSchema: z.object({
        source: z.string().describe('The document filename, e.g. "mcp-tools.md".'),
      }),
    },
    async ({ source }) => {
      const doc = corpusBySource.get(source);
      return {
        content: [{
          type: 'text',
          text: doc ? doc : `No document named "${source}". Known: ${[...corpusBySource.keys()].join(', ')}`,
        }],
      };
    },
  );

  return server;
});

console.error('[anthropic-docs-mcp] server ready on stdio');
