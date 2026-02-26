import { createTool } from '@mastra/core/tools';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

export const saveSummaryTool = createTool({
  id: 'save-summary',
  description: 'Saves a summary to the local workspace as a markdown file',
  inputSchema: z.object({
    title: z.string(),
    url: z.string(),
    summary: z.string(),
  }),
  outputSchema: z.object({
    filePath: z.string(),
  }),
  execute: async ({ title, url, summary }) => {

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50);
    const fileName = `${slug}-${Date.now()}.md`;
    const filePath = path.join('./workspace/summaries', fileName);

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const content = `# ${title}\n\n> Source: ${url}\n\n${summary}\n`;
    await fs.writeFile(filePath, content, 'utf-8');

    return { filePath };
  },
});
