# anthropic-docs-mcp

An MCP server that exposes semantic **vector search** over a documentation corpus as
**tools**, plus a **Claude agentic loop** that calls those tools through the Model
Context Protocol. Built to be small enough to understand completely and defend line
by line.

Everything here except the live API call in `scripts/agent.mjs` has been run end to end.

## What it demonstrates

| Skill| Where it lives |
|---|---|
| MCP server (build + understand) | `src/server.mjs` — `registerTool` over stdio, MCP v2 |
| Agentic tool-use loop on Claude | `scripts/agent.mjs` — request → `tool_use` → execute → `tool_result` → repeat |
| Vector search | `src/retrieval.mjs` — chunking, embeddings, cosine top-k |
| Context engineering | chunking + retrieval + source-tagged formatting feeding the model |
| Anthropic fluency | corpus is Anthropic's own MCP/tool-use docs; loop uses the Messages API |

## Architecture

```
                 ┌──────────────────┐   MCP (JSON-RPC over stdio)   ┌────────────────────┐
  your question  │  agent.mjs       │ ───── listTools / callTool ──▶│  server.mjs (MCP)  │
  ───────────────▶  (MCP client +   │                               │  search_docs       │
                 │   Claude loop)   │◀──── tool results ────────────│  get_doc           │
                 └────────┬─────────┘                               └─────────┬──────────┘
                          │ Messages API (tool_use / tool_result)             │
                          ▼                                                   ▼
                    api.anthropic.com                                  retrieval.mjs
                                                                 (embed → cosine → top-k)
```

The server never talks to Claude directly. The **host** (Claude Desktop, or `agent.mjs`
acting as host) owns the model connection; the server only exposes tools. That
separation is the whole point of MCP.

## Run it

```bash
npm install

# 1. build the vector index from the corpus
node scripts/build-index.mjs                 # real local embeddings (downloads MiniLM once)
#   or, no downloads / offline:
EMBEDDER=hash node scripts/build-index.mjs

# 2. prove the MCP server works (client connects over stdio, lists + calls tools)
EMBEDDER=hash node scripts/test-client.mjs

# 3. run the unit tests
node scripts/test-retrieval.mjs

# 4. run the full agentic loop (needs your key)
ANTHROPIC_API_KEY=sk-... node scripts/agent.mjs "How do I connect a remote MCP server to the API?"
```

To use it from **Claude Desktop** instead of the script, see
`claude_desktop_config.example.json`.

## The two embedders

`src/embedder.mjs` exposes one interface, `(texts) => Promise<number[][]>`, with two backends:

- **`makeLocalEmbedder()`** — real semantic embeddings via `@huggingface/transformers`
  (`all-MiniLM-L6-v2`, 384-dim), fully local, no API key, no server. **Use this.**
- **`makeHashEmbedder()`** — deterministic hashing embedding, zero dependencies, no
  downloads. Real vectors but not semantic; used for offline tests and CI.

Nothing downstream changes when you swap them — that is the point of the abstraction.

## Design decisions I can defend

- **Exact cosine search, not an ANN index.** For a docs-sized corpus, scanning every
  vector is sub-millisecond and returns the *true* top-k. HNSW would trade accuracy for
  speed I don't need at this scale. (The corpus doc `vector-search.md` explains when
  you'd switch.)
- **Vectors persisted as JSON.** One file, human-inspectable, no database process to run.
- **stdio transport.** The server runs as a child process of the host — no network, no
  auth, no deployment. The same server can be served over Streamable HTTP for remote use.
- **MCP tool schemas are Zod, validated before the handler runs**, so malformed tool
  calls never reach my code.

## Honest scope

This is a working prototype, not a deployed production system. It shows I can build and
explain an MCP server, an agentic tool-use loop, and vector retrieval on Claude. It does
**not** represent a year of production agentic systems or a live service with users.

## Versions (pinned, verified 2026-08-28)

- `@modelcontextprotocol/server` 2.0.0 · `@modelcontextprotocol/client` 2.0.0 (MCP 2026-07-28 spec)
- `@anthropic-ai/sdk` 0.122.0
- `@huggingface/transformers` 4.2.0 · `zod` 4.5.1 · Node ≥ 18
