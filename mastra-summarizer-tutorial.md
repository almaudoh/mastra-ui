# Building a Full-Featured Summarizer App with Mastra AI

This tutorial builds on the `server.ts` starter you already have and expands it to cover **every major Mastra capability**: Tools, Workflows, Memory, RAG, Evals, Observability, and Streaming. By the end you'll have a production-ready page summarizer that can fetch URLs, remember past sessions, answer questions against a knowledge base, and grade its own output quality.

---

## Project Structure

```
summarizer-app/
├── src/
│   ├── tools/
│   │   ├── fetchPage.ts        # Custom tool: fetch & clean a web page
│   │   └── saveSummary.ts      # Custom tool: persist summaries to disk
│   ├── agents/
│   │   ├── summarizer.ts       # Core summarizer agent (with memory + tools)
│   │   └── critic.ts           # Critic sub-agent for quality review
│   ├── workflows/
│   │   └── summarizeWorkflow.ts # Orchestrated multi-step workflow
│   ├── rag/
│   │   └── ingest.ts           # RAG ingestion pipeline
│   ├── evals/
│   │   └── summaryEval.ts      # Quality evaluators
│   └── server.ts               # Mastra server entry point
├── workspace/                  # Local filesystem sandbox
├── .env
└── package.json
```

---

## 1. Installation & Setup

```bash
npm create mastra@latest summarizer-app
# or add to an existing project:
npm install @mastra/core @mastra/memory @mastra/rag @mastra/evals zod
```

**.env**
```env
OPENROUTER_API_KEY=your_key_here
# or swap for any supported provider:
# OPENAI_API_KEY=...
# ANTHROPIC_API_KEY=...
```

---

## 2. Custom Tools

Tools are typed, async functions that agents call autonomously. You define the input/output schema with Zod, and Mastra handles the rest.

### `src/tools/fetchPage.ts`

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const fetchPageTool = createTool({
  id: "fetch-page",
  description: "Fetches the raw text content of a URL for summarization",
  inputSchema: z.object({
    url: z.string().url().describe("The URL of the page to fetch"),
  }),
  outputSchema: z.object({
    content: z.string(),
    title: z.string(),
    wordCount: z.number(),
  }),
  execute: async ({ context }) => {
    const { url } = context;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SummarizerBot/1.0)" },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status}`);
    }

    const html = await res.text();

    // Strip HTML tags (basic; replace with a proper parser in production)
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    // Extract <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;

    const wordCount = text.split(/\s+/).length;

    // Truncate to 8 000 words to stay within context limits
    const truncated = text.split(/\s+/).slice(0, 8000).join(" ");

    return { content: truncated, title, wordCount };
  },
});
```

### `src/tools/saveSummary.ts`

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";

export const saveSummaryTool = createTool({
  id: "save-summary",
  description: "Saves a summary to the local workspace as a markdown file",
  inputSchema: z.object({
    title: z.string(),
    url: z.string(),
    summary: z.string(),
  }),
  outputSchema: z.object({
    filePath: z.string(),
  }),
  execute: async ({ context }) => {
    const { title, url, summary } = context;

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50);
    const fileName = `${slug}-${Date.now()}.md`;
    const filePath = path.join("./workspace/summaries", fileName);

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const content = `# ${title}\n\n> Source: ${url}\n\n${summary}\n`;
    await fs.writeFile(filePath, content, "utf-8");

    return { filePath };
  },
});
```

---

## 3. Agents

### Core Summarizer Agent — `src/agents/summarizer.ts`

The summarizer agent now gets **tools** and **memory** so it can fetch pages, save output, and remember past conversations.

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { fetchPageTool } from "../tools/fetchPage";
import { saveSummaryTool } from "../tools/saveSummary";

// --- Memory ---
// LibSQLStore persists threads to a local SQLite DB.
// Swap for PostgresStore or UpstashStore in production.
const memory = new Memory({
  storage: new LibSQLStore({ url: "file:./workspace/memory.db" }),
  options: {
    lastMessages: 20,       // keep the last 20 messages in context
    semanticRecall: false,  // enable if you add a vector store
  },
});

export const summarizerAgent = new Agent({
  id: "summarizer",
  name: "Page Summarizer",
  instructions: `
    You summarize web content clearly and concisely.

    When the user provides a URL:
    1. Use the fetch-page tool to retrieve the content.
    2. Summarize using bullet points, highlighting key insights.
    3. Keep the summary under 150 words.
    4. After summarizing, use the save-summary tool to persist it.
    5. Tell the user where the file was saved.

    Rules:
    - Avoid fluff and filler phrases
    - Lead with the most important insight
    - If the page cannot be fetched, explain why clearly
  `,
  model: "openrouter/nvidia/nemotron-3-nano-30b-a3b:free",
  tools: {
    fetchPageTool,
    saveSummaryTool,
  },
  memory,
});
```

### Critic Sub-Agent — `src/agents/critic.ts`

A second agent that reviews summaries for quality. It will be wired into the workflow below.

```typescript
import { Agent } from "@mastra/core/agent";

export const criticAgent = new Agent({
  id: "critic",
  name: "Summary Critic",
  instructions: `
    You are a strict editorial critic. You receive a summary and evaluate it on:
    - Accuracy: does it reflect the source content faithfully?
    - Conciseness: is it under 150 words?
    - Clarity: is it easy to understand?

    Respond with JSON in this exact format:
    {
      "score": <0-10>,
      "issues": ["<issue 1>", "..."],
      "suggestion": "<one-line improvement>"
    }
  `,
  model: "openrouter/nvidia/nemotron-3-nano-30b-a3b:free",
});
```

---

## 4. Workflows

Workflows give you deterministic control over multi-step processes. Unlike agents (which reason freely), workflows define an explicit execution graph.

### `src/workflows/summarizeWorkflow.ts`

```typescript
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { fetchPageTool } from "../tools/fetchPage";
import { saveSummaryTool } from "../tools/saveSummary";

// ── Step 1: Fetch the page ───────────────────────────────────────────────────
const fetchStep = createStep({
  id: "fetch-page",
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({
    content: z.string(),
    title: z.string(),
    wordCount: z.number(),
    url: z.string(),
  }),
  execute: async ({ inputData }) => {
    const result = await fetchPageTool.execute(
      { url: inputData.url },
      { requestContext: {} as any }
    );
    return { ...result, url: inputData.url };
  },
});

// ── Step 2: Summarize via the agent ──────────────────────────────────────────
// Import the agent and compose it directly as a step.
import { summarizerAgent } from "../agents/summarizer";

const summarizeStep = createStep(summarizerAgent);

// ── Step 3: Critique the summary ─────────────────────────────────────────────
import { criticAgent } from "../agents/critic";

const critiqueStep = createStep({
  id: "critique",
  inputSchema: z.object({ text: z.string(), title: z.string(), url: z.string() }),
  outputSchema: z.object({
    score: z.number(),
    issues: z.array(z.string()),
    suggestion: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const critic = mastra!.getAgent("critic");
    const response = await critic.generate(
      `Please critique this summary of "${inputData.title}":\n\n${inputData.text}`
    );
    // The critic was instructed to return JSON
    try {
      return JSON.parse(response.text);
    } catch {
      return { score: 5, issues: ["Could not parse critique"], suggestion: "" };
    }
  },
});

// ── Step 4: Save only if score ≥ 7 ──────────────────────────────────────────
const conditionalSaveStep = createStep({
  id: "conditional-save",
  inputSchema: z.object({
    score: z.number(),
    summary: z.string(),
    title: z.string(),
    url: z.string(),
  }),
  outputSchema: z.object({ saved: z.boolean(), filePath: z.string().optional() }),
  execute: async ({ inputData }) => {
    if (inputData.score < 7) {
      console.log(`Summary scored ${inputData.score}/10 — skipping save.`);
      return { saved: false };
    }
    const result = await saveSummaryTool.execute(
      { title: inputData.title, url: inputData.url, summary: inputData.summary },
      { requestContext: {} as any }
    );
    return { saved: true, filePath: result.filePath };
  },
});

// ── Compose the workflow ─────────────────────────────────────────────────────
export const summarizeWorkflow = createWorkflow({
  id: "summarize-workflow",
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({ saved: z.boolean(), filePath: z.string().optional() }),
})
  .then(fetchStep)
  // Map fetchStep output → summarizeStep prompt
  .map(async ({ inputData }) => ({
    prompt: `Summarize the following article titled "${inputData.title}":\n\n${inputData.content}`,
  }))
  .then(summarizeStep)
  // Map summarizeStep text output → critiqueStep
  .map(async ({ inputData, getPreviousStepOutput }) => {
    const fetch = await getPreviousStepOutput("fetch-page");
    return {
      text: inputData.text,
      title: fetch.title,
      url: fetch.url,
    };
  })
  .then(critiqueStep)
  // Map critique + summary → conditional save
  .map(async ({ inputData, getPreviousStepOutput }) => {
    const summarize = await getPreviousStepOutput("summarizer");
    const fetch = await getPreviousStepOutput("fetch-page");
    return {
      score: inputData.score,
      summary: summarize.text,
      title: fetch.title,
      url: fetch.url,
    };
  })
  .then(conditionalSaveStep)
  .commit();
```

> **Workflow primitives** available beyond `.then()`:
> - `.branch()` — conditional branching based on output
> - `.parallel()` — run steps concurrently
> - `.until()` / `.while()` — loops
> - `.suspend()` / `.resume()` — human-in-the-loop pauses

---

## 5. RAG — Summarize Against a Knowledge Base

RAG lets your agent answer questions grounded in documents you've indexed.

### `src/rag/ingest.ts`

```typescript
import { MDocument, embed } from "@mastra/rag";
import { LibSQLVector } from "@mastra/libsql";
import { openai } from "@ai-sdk/openai"; // or any embedding provider

const vectorStore = new LibSQLVector({ url: "file:./workspace/vectors.db" });

/**
 * Ingest a plain-text document into the vector store.
 * Call this once (or on a schedule) to build your knowledge base.
 */
export async function ingestDocument(text: string, metadata: Record<string, string>) {
  const doc = MDocument.fromText(text, metadata);

  // Chunk the document into overlapping segments
  const chunks = await doc.chunk({
    strategy: "recursive",
    size: 512,
    overlap: 50,
  });

  // Embed each chunk
  const { embeddings } = await embed(chunks, {
    provider: openai.embedding("text-embedding-3-small"),
    maxRetries: 3,
  });

  // Store in LibSQL vector DB
  await vectorStore.upsert({
    indexName: "summaries",
    vectors: embeddings,
    metadata: chunks.map((c) => ({ text: c.text, ...metadata })),
  });

  console.log(`Ingested ${chunks.length} chunks from "${metadata.title}"`);
}
```

### Wire a RAG Query Tool into the Agent

```typescript
// src/tools/ragQuery.ts
import { createVectorQueryTool } from "@mastra/rag";
import { LibSQLVector } from "@mastra/libsql";
import { openai } from "@ai-sdk/openai";

const vectorStore = new LibSQLVector({ url: "file:./workspace/vectors.db" });

export const ragQueryTool = createVectorQueryTool({
  vectorStoreName: "local",
  indexName: "summaries",
  model: openai.embedding("text-embedding-3-small"),
  description: "Search previously ingested summaries for relevant context",
});

// Then add ragQueryTool to the summarizerAgent's tools object:
// tools: { fetchPageTool, saveSummaryTool, ragQueryTool }
```

---

## 6. Streaming Responses

Instead of waiting for the full response, stream tokens to the client in real time.

```typescript
// Example: stream from the summarizer agent
const stream = await summarizerAgent.stream(
  "Summarize https://example.com/article",
  {
    threadId: "user-session-123",   // enables memory across calls
    resourceId: "user-42",          // links thread to a user
    onFinish: ({ text, usage, steps }) => {
      console.log("Done. Tokens used:", usage?.totalTokens);
      console.log("Tool calls:", steps.length);
    },
  }
);

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

### Streaming a Workflow

```typescript
const run = summarizeWorkflow.createRun();

const { stream } = await run.stream({ url: "https://example.com/article" });

for await (const event of stream) {
  if (event.type === "step-complete") {
    console.log(`✓ Step "${event.stepId}" complete`);
  }
  if (event.type === "workflow-complete") {
    console.log("Final output:", event.output);
  }
}
```

---

## 7. Structured Output

Force the agent to return typed JSON using a Zod schema.

```typescript
import { z } from "zod";

const SummarySchema = z.object({
  title: z.string(),
  keyPoints: z.array(z.string()).max(5),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  wordCount: z.number(),
});

const response = await summarizerAgent.generate(
  "Summarize https://example.com/article",
  { output: SummarySchema }
);

// response.object is fully typed as z.infer<typeof SummarySchema>
console.log(response.object.keyPoints);
```

---

## 8. Evals — Measuring Summary Quality

Evals let you score agent outputs automatically, either with model-graded metrics or rule-based checks.

### `src/evals/summaryEval.ts`

```typescript
import { evaluate } from "@mastra/evals";
import {
  SummarizationMetric,
  ToxicityMetric,
  ContentSimilarityMetric,
} from "@mastra/evals/metrics";

export async function runEvals(sourceText: string, summary: string) {
  const results = await evaluate({
    input: sourceText,
    output: summary,
    metrics: [
      // Model-graded: does the summary faithfully represent the source?
      new SummarizationMetric({ model: "openrouter/nvidia/nemotron-3-nano-30b-a3b:free" }),

      // Rule-based: is the output free of harmful content?
      new ToxicityMetric(),

      // Statistical: semantic similarity between source and summary
      new ContentSimilarityMetric({ threshold: 0.6 }),
    ],
  });

  results.forEach(({ metric, score, reason }) => {
    console.log(`[${metric}] Score: ${score} — ${reason}`);
  });

  return results;
}
```

---

## 9. Observability & Logging

```typescript
// In server.ts — configure logging and tracing
import { Mastra } from "@mastra/core";
import { PinoLogger } from "@mastra/loggers";

export const mastraServer = new Mastra({
  // ... agents, workflows ...
  logger: new PinoLogger({ level: "info" }),
  telemetry: {
    serviceName: "summarizer-app",
    // Export traces to any OpenTelemetry-compatible backend
    // e.g., Jaeger, Honeycomb, Langfuse
    exporter: "otlp",
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  },
});
```

All agent calls, tool invocations, token usage, and step timings are automatically traced.

---

## 10. Full `server.ts`

Putting it all together:

```typescript
import { Mastra } from "@mastra/core";
import { Workspace, LocalFilesystem, LocalSandbox } from "@mastra/core/workspace";
import { PinoLogger } from "@mastra/loggers";

import { summarizerAgent } from "./agents/summarizer";
import { criticAgent } from "./agents/critic";
import { summarizeWorkflow } from "./workflows/summarizeWorkflow";

const workspace = new Workspace({
  filesystem: new LocalFilesystem({ basePath: "./workspace" }),
  sandbox: new LocalSandbox({ workingDirectory: "./workspace" }),
});

export const mastraServer = new Mastra({
  workspace,

  agents: {
    summarizer: summarizerAgent,
    critic: criticAgent,
  },

  workflows: {
    summarizeWorkflow,
  },

  logger: new PinoLogger({ level: "info" }),

  server: {
    port: 3000,
    host: "0.0.0.0",
    // CORS for a frontend client
    cors: {
      origin: ["http://localhost:5173"],
      allowMethods: ["GET", "POST"],
    },
  },
});
```

---

## 11. Calling the API

Once the server is running (`npx mastra dev` or `npx ts-node src/server.ts`), Mastra auto-generates REST endpoints for every registered agent and workflow:

```bash
# Generate a summary (blocking)
curl -X POST http://localhost:3000/api/agents/summarizer/generate \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Summarize https://example.com"}]}'

# Stream a summary
curl -X POST http://localhost:3000/api/agents/summarizer/stream \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Summarize https://example.com"}]}'

# Run the full workflow
curl -X POST http://localhost:3000/api/workflows/summarizeWorkflow/start \
  -H "Content-Type: application/json" \
  -d '{"inputData": {"url": "https://example.com"}}'
```

---

## 12. Using the Mastra Client (Frontend)

```typescript
import { MastraClient } from "@mastra/client";

const client = new MastraClient({ baseUrl: "http://localhost:3000" });

// Simple generate
const agent = client.getAgent("summarizer");
const result = await agent.generate({
  messages: [{ role: "user", content: "Summarize https://news.ycombinator.com" }],
  threadId: "my-thread-id",   // persist memory across calls
});
console.log(result.text);

// Stream
const stream = await agent.stream({
  messages: [{ role: "user", content: "Summarize https://example.com" }],
});
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}

// Run a workflow
const workflow = client.getWorkflow("summarizeWorkflow");
const run = await workflow.createRun();
await run.start({ inputData: { url: "https://example.com" } });
```

---

## Summary of Mastra Capabilities Covered

| Capability | Where Used |
|---|---|
| **Agent** | `summarizerAgent`, `criticAgent` |
| **Tools** | `fetchPageTool`, `saveSummaryTool`, `ragQueryTool` |
| **Memory** | `LibSQLStore` in summarizer agent |
| **Workflows** | `summarizeWorkflow` (fetch → summarize → critique → save) |
| **Branching / Mapping** | `.map()` between workflow steps |
| **RAG** | `ingestDocument()` + `createVectorQueryTool` |
| **Structured Output** | `agent.generate({ output: SummarySchema })` |
| **Streaming** | `agent.stream()`, `workflow.stream()` |
| **Evals** | `SummarizationMetric`, `ToxicityMetric`, `ContentSimilarityMetric` |
| **Observability** | `PinoLogger` + OTLP telemetry |
| **REST API** | Auto-generated by `Mastra` server |
| **Client SDK** | `MastraClient` for frontend integration |

---

## Next Steps

- **Deploy**: `npx mastra deploy` targets Vercel, Cloudflare Workers, or any Node.js host
- **MCP Server**: expose your agent via the Model Context Protocol for use in other AI systems
- **Agent Networks**: add a supervisor agent that routes tasks between the summarizer and critic dynamically
- **Human-in-the-Loop**: add `.suspend()` in the workflow to pause and wait for user approval before saving
