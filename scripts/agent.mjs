// agent.mjs — the agentic loop.
//
// Connects to the MCP server as a client, hands the MCP tools to Claude via the
// Messages API, and runs the request -> tool_use -> execute -> tool_result ->
// respond loop until Claude produces a final answer.
//
// Needs Anthropic credentials (ANTHROPIC_API_KEY, or a profile from `ant auth login`).
// Written against @anthropic-ai/sdk@0.122.0 and @modelcontextprotocol/client@2.0.0.
//
// Environment:
//   ANTHROPIC_MODEL   model to use (default claude-opus-5-5)
//   MAX_TURNS         maximum model turns (default 6)
//   EMBEDDER          embedder the server uses (default hash; must match the index)
//
// Run:  node scripts/agent.mjs "How do I connect a remote MCP server to the API?"

import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'src', 'server.mjs');

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5';
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 6);
const question = process.argv[2] ?? 'What is the core agentic loop in Claude tool use?';

// ---- 1. connect to the MCP server as a client ----
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, EMBEDDER: process.env.EMBEDDER ?? 'hash' },
});
const mcp = new Client({ name: 'agent', version: '1.0.0' });
await mcp.connect(transport);

try {
  // ---- 2. translate MCP tool definitions into Anthropic tool definitions ----
  const { tools: mcpTools } = await mcp.listTools();
  const anthropicTools = mcpTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,   // MCP already exposes JSON Schema; Claude consumes it directly
  }));

  // ---- 3. run the agentic loop ----
  const anthropic = new Anthropic();
  const messages = [{ role: 'user', content: question }];
  const textOf = (content) => content.filter((b) => b.type === 'text').map((b) => b.text).join('');

  let finished = false;
  for (let turn = 0; turn < MAX_TURNS && !finished; turn++) {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      tools: anthropicTools,
      messages,
      // If the model declines (stop_reason "refusal"), the API retries on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

    // record Claude's turn (full content, so later requests see it unchanged)
    messages.push({ role: 'assistant', content: response.content });

    switch (response.stop_reason) {
      case 'end_turn':
      case 'stop_sequence':
        console.log('\n=== FINAL ANSWER ===\n' + textOf(response.content));
        finished = true;
        break;

      case 'max_tokens':
        console.log('\n=== PARTIAL ANSWER (cut off at max_tokens) ===\n' + textOf(response.content));
        process.exitCode = 1;
        finished = true;
        break;

      case 'refusal':
        console.error(`[agent] request declined (category: ${response.stop_details?.category ?? 'unknown'})`);
        process.exitCode = 1;
        finished = true;
        break;

      case 'pause_turn':
        // Assistant turn already appended; sending it back lets the server continue.
        break;

      case 'tool_use': {
        // execute every tool_use block Claude requested, via MCP
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          console.error(`[agent] Claude calls ${block.name}(${JSON.stringify(block.input)})`);
          try {
            const result = await mcp.callTool({ name: block.name, arguments: block.input });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result.content,   // text blocks pass straight back to Claude
              is_error: Boolean(result.isError),
            });
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Tool call failed: ${err.message}`,
              is_error: true,
            });
          }
        }
        messages.push({ role: 'user', content: toolResults });
        break;
      }

      default:
        console.error(`[agent] unexpected stop_reason: ${response.stop_reason}`);
        process.exitCode = 1;
        finished = true;
    }
  }

  if (!finished) {
    console.error(`[agent] stopped after ${MAX_TURNS} turns without a final answer (raise MAX_TURNS to allow more)`);
    process.exitCode = 1;
  }
} finally {
  await mcp.close();
}
