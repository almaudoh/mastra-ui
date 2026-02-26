import { mastraServer as mastra } from "@/src/mastra";
import { createUIMessageStreamResponse } from 'ai';
import { handleChatStream } from '@mastra/ai-sdk';

export async function POST(req: Request) {
  const params = await req.json();
  const stream = await handleChatStream({
    mastra,
    agentId: 'summarizer',
    params,
  });
  return createUIMessageStreamResponse({ stream });
}
