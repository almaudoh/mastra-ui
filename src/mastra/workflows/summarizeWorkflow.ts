import { createStep, createWorkflow } from '@mastra/core/workflows';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { criticAgent } from '../agents/critic.ts';
import { summarizerAgent } from '../agents/summarizer.ts';

type FetchStepOutput = {
  content: string;
  title: string;
  wordCount: number;
  url: string;
};

const fetchStep = createStep({
  id: 'fetch-page',
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({
    content: z.string(),
    title: z.string(),
    wordCount: z.number(),
    url: z.string(),
  }),
  execute: async ({ inputData }) => {
    const res = await fetch(inputData.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SummarizerBot/1.0)' },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch ${inputData.url}: ${res.status}`);
    }

    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : inputData.url;
    const wordCount = text.split(/\s+/).length;
    const content = text.split(/\s+/).slice(0, 8000).join(' ');

    return { content, title, wordCount, url: inputData.url };
  },
});

const summarizeStep = createStep(summarizerAgent);

const critiqueStep = createStep({
  id: 'critique',
  inputSchema: z.object({ text: z.string(), title: z.string(), url: z.string() }),
  outputSchema: z.object({
    score: z.number(),
    issues: z.array(z.string()),
    suggestion: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const critic = mastra.getAgent('critic');
    const response = await critic.generate(
      `Please critique this summary of "${inputData.title}":\n\n${inputData.text}`
    );
    try {
      return JSON.parse(response.text);
    } catch {
      return { score: 5, issues: ['Could not parse critique'], suggestion: '' };
    }
  },
});

const conditionalSaveStep = createStep({
  id: 'conditional-save',
  inputSchema: z.object({
    score: z.number(),
    summary: z.string(),
    title: z.string(),
    url: z.string(),
  }),
  outputSchema: z.object({ saved: z.boolean(), filePath: z.string().optional() }),
  execute: async ({ inputData }) => {
    if (inputData.score < 7) {
      return { saved: false };
    }

    const slug = inputData.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50);
    const fileName = `${slug}-${Date.now()}.md`;
    const filePath = path.join('./workspace/summaries', fileName);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `# ${inputData.title}\n\n> Source: ${inputData.url}\n\n${inputData.summary}\n`,
      'utf-8'
    );

    return { saved: true, filePath };
  },
});

export const summarizeWorkflow = createWorkflow({
  id: 'summarize-workflow',
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({ saved: z.boolean(), filePath: z.string().optional() }),
})
  .then(fetchStep)
  .map(async ({ inputData }) => ({
    prompt: `Summarize the following article titled "${inputData.title}":\n\n${inputData.content}`,
  }))
  .then(summarizeStep)
  .map(async ({ inputData, getStepResult }) => {
    const fetch = getStepResult<FetchStepOutput>('fetch-page');
    const text =
      typeof (inputData as { text?: unknown }).text === 'string'
        ? (inputData as { text: string }).text
        : JSON.stringify(inputData);

    return {
      text,
      title: fetch.title,
      url: fetch.url,
    };
  })
  .then(critiqueStep)
  .map(async ({ inputData, getStepResult }) => {
    const summarize = getStepResult<{ text?: string }>('summarizer');
    const fetch = getStepResult<FetchStepOutput>('fetch-page');
    return {
      score: inputData.score,
      summary: summarize.text ?? '',
      title: fetch.title,
      url: fetch.url,
    };
  })
  .then(conditionalSaveStep)
  .commit();
