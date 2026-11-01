# anthropic-docs-mcp

A Model Context Protocol (MCP) server that provides vector search over a small documentation corpus, together with a command-line agent that lets Claude call the server's tools.

The repository is a compact reference implementation. It contains about 600 lines of JavaScript covering text chunking, embeddings, cosine-similarity search, an MCP server, and a tool-use loop on the Anthropic Messages API.

## How it works

```
 question ──▶ scripts/agent.mjs ──── MCP over stdio ────▶ src/server.mjs
              (MCP client and                             tools: search_docs, get_doc
               Claude tool loop)                                   │
                     │                                             ▼
                     ▼                                     src/retrieval.mjs
             Anthropic Messages API                        (chunk, embed, rank)
```

The server exposes two tools and never contacts the model. The host application, which is either Claude Desktop or `scripts/agent.mjs`, owns the model connection. It lists the server's tools, passes them to Claude, runs each tool call Claude requests, and returns the results until Claude gives a final answer.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `search_docs` | `query` (string), `k` (integer 1 to 10, default 3) | The `k` most similar chunks, each with its source file and similarity score |
| `get_doc` | `source` (string) | The full text of one document |

Arguments are validated against a Zod schema before a handler runs.

## Requirements

- Node.js 20 or newer (required by the MCP SDK)
- Anthropic credentials (`ANTHROPIC_API_KEY`, or a profile from `ant auth login`), needed only for `scripts/agent.mjs`

## Setup

```bash
git clone https://github.com/Amireshhhh/Claude_MCP.git
cd Claude_MCP
npm install
```

`npm install` also downloads the ONNX runtime used by the semantic embedder. If you only need the offline hash embedder, `npm install --ignore-scripts` skips that download.

## Usage

Build the vector index. It is written to `data/index.json`, which is not committed.

```bash
npm run build-index            # semantic embeddings, downloads the model on first run
npm run build-index:offline    # hash embedder, no downloads
```

Run the tests:

```bash
npm test             # retrieval unit tests
npm run test:mcp     # starts the server and calls its tools through an MCP client
npm run stress       # load test: search_docs calls over MCP (run build-index:offline first)
```

Ask a question through Claude:

```bash
export ANTHROPIC_API_KEY=...
EMBEDDER=local node scripts/agent.mjs "How do I connect a remote MCP server to the API?"
```

The agent prints each tool call to stderr and the final answer to stdout. It exits with status 1 if the answer was cut off at `max_tokens`, the request was declined, or it ran out of turns without an answer.

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model to use |
| `MAX_TURNS` | `6` | Maximum model turns |
| `EMBEDDER` | `hash` | Embedder the server queries with; must match the index |

Requests enable the API's server-side refusal fallback (`fallbacks: "default"`), so a declined request is retried on a fallback model.

### Claude Desktop

Copy the `mcpServers` entry from `claude_desktop_config.example.json` into your Claude Desktop configuration file, replace `ABSOLUTE_PATH_TO_REPO` with the path to this repository, and restart Claude Desktop.

## Embedders

Set the `EMBEDDER` environment variable to choose one.

| Value | Description |
|---|---|
| `local` | `all-MiniLM-L6-v2` (384 dimensions) through `@huggingface/transformers`. Runs on your machine with no API key. |
| `hash` | Hashes each token into a 384-dimension bag-of-words vector. No dependencies and no downloads, but it matches on shared words, not meaning. Intended for tests and offline use. |

Use the same embedder to build the index and to query it. The index records which embedder built it, and the server refuses to start if the current embedder is different, because vectors from two embedders cannot be compared. The server and the build script use `local` unless `EMBEDDER=hash` is set. `scripts/agent.mjs` and the test scripts start the server with `hash` unless you set `EMBEDDER` yourself.

## Design notes

- **Exact search.** Every query is compared against every chunk. At this corpus size that is fast and always returns the true top results, so an approximate nearest-neighbour index would add complexity for no benefit.
- **Chunking.** Documents are split into windows of 180 words with a 40-word overlap.
- **Storage.** The index is a single JSON file. There is no database to run.
- **Transport.** The server uses stdio and runs as a child process of the host, so there is no network listener or authentication to configure.

## Limitations

- The corpus is six short documents about MCP, tool use and retrieval (`data/corpus.json`). Replace that file and rebuild the index to search your own content.
- The index is held in memory and scanned linearly, which will not scale to a large corpus.
- The agent has no streaming or conversation memory.

## Project layout

```
src/
  server.mjs       MCP server and tool definitions
  retrieval.mjs    chunking, cosine similarity, vector index
  embedder.mjs     the two embedders
scripts/
  build-index.mjs      embeds the corpus and writes data/index.json
  agent.mjs            MCP client and Claude tool-use loop
  test-client.mjs      MCP integration test
  test-retrieval.mjs   unit tests
  stress.mjs           load test through the MCP protocol
data/
  corpus.json      source documents
```

## Dependencies

`@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.4, `@anthropic-ai/sdk` 0.122, `@huggingface/transformers` 4, `zod` 4.6.
