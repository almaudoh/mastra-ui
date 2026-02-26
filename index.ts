// Simple streaming.

import { agent } from 'mastra/agents/summarizer.ts';

const stream = await agent.stream({
  messages: [
    { role: "user", content: "Summarize this article..." }
  ]
});

for await (const chunk of stream) {
  process.stdout.write(chunk);
}