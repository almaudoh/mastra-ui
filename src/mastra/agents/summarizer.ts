import { Agent } from '@mastra/core/agent';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { fetchPageTool } from '../tools/fetchPage.ts';
import { ragQueryTool } from '../tools/ragQuery.ts';
import { saveSummaryTool } from '../tools/saveSummary.ts';
import { getDbPath } from '../utils.ts';

const memory = new Memory({
	storage: new LibSQLStore({ id: 'memory-store', url: `file:${getDbPath()}/memory.db` }),
	options: {
		lastMessages: 20,
		semanticRecall: false,
	},
});

export const summarizerAgent = new Agent({
	id: 'summarizer',
	name: 'Page Summarizer',
	instructions: `
		You summarize web content clearly and concisely.

		When the user provides a URL:
		1. Use the fetch-page tool to retrieve the content.
		2. Summarize using bullet points, highlighting key insights.
		3. Keep the summary under 150 words.
		4. After summarizing, use the save-summary tool to persist it.
		5. Tell the user where the file was saved.

		Rules:
		- Avoid fluff and filler phrases
		- Lead with the most important insight
		- If the page cannot be fetched, explain why clearly
	`,
	model: 'openrouter/nvidia/nemotron-3-nano-30b-a3b:free',
	tools: {
		fetchPageTool,
		saveSummaryTool,
		ragQueryTool,
	},
	memory,
});
