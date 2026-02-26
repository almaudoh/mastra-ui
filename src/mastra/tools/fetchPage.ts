import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const fetchPageTool = createTool({
	id: 'fetch-page',
	description: 'Fetches the raw text content of a URL for summarization',
	inputSchema: z.object({
		url: z.string().url().describe('The URL of the page to fetch'),
	}),
	outputSchema: z.object({
		content: z.string(),
		title: z.string(),
		wordCount: z.number(),
	}),
	execute: async ({ url }) => {

		const res = await fetch(url, {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SummarizerBot/1.0)' },
		});

		if (!res.ok) {
			throw new Error(`Failed to fetch ${url}: ${res.status}`);
		}

		const html = await res.text();

		const text = html
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s{2,}/g, ' ')
			.trim();

		const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
		const title = titleMatch ? titleMatch[1].trim() : url;

		const wordCount = text.split(/\s+/).length;
		const truncated = text.split(/\s+/).slice(0, 8000).join(' ');

		return { content: truncated, title, wordCount };
	},
});
