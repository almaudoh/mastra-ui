import { Mastra } from "@mastra/core";
import { PinoLogger } from '@mastra/loggers';
import { criticAgent } from './agents/critic.ts';
import { summarizerAgent } from './agents/summarizer.ts';
import { summarizeWorkflow } from './workflows/summarizeWorkflow.ts';
import { workspace } from './workspace.ts';

export const mastraServer = new Mastra({
  workspace,

  agents: {
    summarizer: summarizerAgent,
    critic: criticAgent,
  },

  workflows: {
    summarizeWorkflow,
  },

  logger: new PinoLogger({ level: 'info' }),

  server: {
    port: 3000,
    host: '0.0.0.0',
    cors: {
      origin: ['http://localhost:5173'],
      allowMethods: ['GET', 'POST'],
    },
  },
});
