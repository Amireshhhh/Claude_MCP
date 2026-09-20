// test-client.mjs — spins up the server as a subprocess, speaks MCP over stdio,
// lists tools, and calls search_docs. This exercises the real JSON-RPC protocol.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'src', 'server.mjs');

const transport = new StdioClientTransport({
  command: process.execPath,          // node
  args: [serverPath],
  env: { ...process.env, EMBEDDER: process.env.EMBEDDER ?? 'hash' },
});

const client = new Client({ name: 'test-client', version: '1.0.0' });
await client.connect(transport);
console.log('connected.');

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

const res = await client.callTool({
  name: 'search_docs',
  arguments: { query: 'how does the agentic tool use loop work', k: 2 },
});
console.log('--- search_docs result ---');
console.log(res.content[0].text);

await client.close();
console.log('closed.');
