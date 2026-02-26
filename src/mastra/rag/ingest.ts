import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { LibSQLVector } from '@mastra/libsql';
import { MDocument } from '@mastra/rag';
import { getDbPath } from '../utils.ts';

const vectorStore = new LibSQLVector({
  id: 'local-vectors',
  url: `file:${getDbPath()}/vectors.db`,
});

export async function ingestDocument(text: string, metadata: Record<string, string>) {
  const doc = MDocument.fromText(text, metadata);

  const chunks = await doc.chunk({
    strategy: 'recursive',
    maxSize: 512,
    overlap: 50,
  });

  const { embeddings } = await embedMany({
    model: openai.embedding('text-embedding-3-small'),
    values: chunks.map((chunk) => chunk.text),
    maxRetries: 3,
  });

  await vectorStore.upsert({
    indexName: 'summaries',
    vectors: embeddings,
    metadata: chunks.map((chunk) => ({ text: chunk.text, ...metadata })),
  });

  console.log(`Ingested ${chunks.length} chunks from "${metadata.title}"`);
}
