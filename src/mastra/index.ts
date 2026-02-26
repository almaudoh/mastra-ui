import { Mastra } from "@mastra/core";
import { PinoLogger } from '@mastra/loggers';
import { Observability, DefaultExporter } from '@mastra/observability';
import { criticAgent } from './agents/critic.ts';
import { summarizerAgent } from './agents/summarizer.ts';
import { summarizeWorkflow } from './workflows/summarizeWorkflow.ts';
import { workspace } from './workspace.ts';
import { LibSQLStore } from '@mastra/libsql';
import { getDbPath } from './utils.ts';

export const mastra = new Mastra({
  workspace,

  agents: {
    summarizer: summarizerAgent,
    critic: criticAgent,
  },

  workflows: {
    summarizeWorkflow,
  },

  logger: new PinoLogger({ level: 'info' }),

  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: `file:${getDbPath()}/mastra.db`,
  }),

  observability: new Observability({
    configs: {
      default: {
        serviceName: 'my-mastra-service',
        exporters: [new DefaultExporter()], // Stores logs/traces
      },
    },
  }),

  server: {
    port: 3000,
    host: '0.0.0.0',
    cors: {
      origin: ['*'],
      allowMethods: ['GET', 'POST'],
    },
  },
});
