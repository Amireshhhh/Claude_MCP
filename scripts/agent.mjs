// agent.mjs — the agentic loop.
//
// This is the file that demonstrates gap #1 (agentic tool use on Claude).
// It connects to the MCP server as a client, hands the MCP tools to Claude via
// the Messages API, and runs the request -> tool_use -> execute -> tool_result
// -> respond loop until Claude produces a final answer.
//
// NOTE: this file calls api.anthropic.com and therefore needs ANTHROPIC_API_KEY.
// It is written against @anthropic-ai/sdk@0.122.0 and @modelcontextprotocol/client@2.0.0.
//
// Run:  ANTHROPIC_API_KEY=sk-... node scripts/agent.mjs "How do I connect a remote MCP server to the API?"

import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'src', 'server.mjs');

const MODEL = 'claude-sonnet-4-5';
const question = process.argv[2] ?? 'What is the core agentic loop in Claude tool use?';

// ---- 1. connect to the MCP server as a client ----
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, EMBEDDER: process.env.EMBEDDER ?? 'hash' },
});
const mcp = new Client({ name: 'agent', version: '1.0.0' });
await mcp.connect(transport);

// ---- 2. translate MCP tool definitions into Anthropic tool definitions ----
const { tools: mcpTools } = await mcp.listTools();
const anthropicTools = mcpTools.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema,   // MCP already exposes JSON Schema; Claude consumes it directly
}));

// ---- 3. run the agentic loop ----
const anthropic = new Anthropic();  // reads ANTHROPIC_API_KEY from env
const messages = [{ role: 'user', content: question }];

for (let turn = 0; turn < 6; turn++) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: anthropicTools,
    messages,
  });

  // record Claude's turn
  messages.push({ role: 'assistant', content: response.content });

  if (response.stop_reason !== 'tool_use') {
    // final answer: print all text blocks and stop
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    console.log('\n=== FINAL ANSWER ===\n' + text);
    break;
  }

  // execute every tool_use block Claude requested, via MCP
  const toolResults = [];
  for (const block of response.content) {
    if (block.type !== 'tool_use') continue;
    console.error(`[agent] Claude calls ${block.name}(${JSON.stringify(block.input)})`);
    const result = await mcp.callTool({ name: block.name, arguments: block.input });
    toolResults.push({
      type: 'tool_result',
      tool_use_id: block.id,
      content: result.content,   // MCP content blocks pass straight back to Claude
    });
  }
  messages.push({ role: 'user', content: toolResults });
}

await mcp.close();
