import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { Workspace, LocalFilesystem, LocalSandbox } from "@mastra/core/workspace";

const workspace = new Workspace({
  filesystem: new LocalFilesystem({
    basePath: './workspace',
  }),
  sandbox: new LocalSandbox({
    workingDirectory: './workspace',
  }),
});

export const summarizerAgent = new Agent({
  id: 'summarizer',
  name: 'Page Summarizer',
  instructions: `
    You summarize web content clearly and concisely.

    Rules:
    - Use bullet points
    - Avoid fluff
    - Highlight key insights
    - Keep summaries under 150 words
  `,
  model: 'openrouter/nvidia/nemotron-3-nano-30b-a3b:free',
  // model: 'huggingface/MiniMaxAI/MiniMax-M2.1',
  workspace,
});

export const mastraServer = new Mastra({
  workspace,
  agents: {
    summarizer: summarizerAgent,
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  }
});
