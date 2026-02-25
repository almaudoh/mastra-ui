import { openai } from '@ai-sdk/openai';
import { LibSQLVector } from '@mastra/libsql';
import { createVectorQueryTool } from '@mastra/rag';

const vectorStore = new LibSQLVector({
  id: 'local-vectors',
  url: 'file:./workspace/vectors.db',
});

export const ragQueryTool = createVectorQueryTool({
  vectorStoreName: 'local',
  indexName: 'summaries',
  model: openai.embedding('text-embedding-3-small'),
  description: 'Search previously ingested summaries for relevant context',
  vectorStore,
});
