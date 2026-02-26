import fs from 'fs/promises';
import path from 'path';
import { config } from 'dotenv';
import { summarizerAgent } from '../agents/summarizer.ts';
import { runEvals } from './summaryEval.ts';
import { fetchPageTool } from '../tools/fetchPage.ts';

config();

type CliOptions = {
  url?: string;
  source?: string;
  sourceFile?: string;
  summary?: string;
  summaryFile?: string;
  maxWords: number;
  skipAgent: boolean;
  json: boolean;
  compact: boolean;
};

function printHelp() {
  console.log(`
Summary Eval CLI

Usage:
  npx -y node@23 --env-file=../.env mastra/evals/runSummaryEval.ts [options]

Options:
  --url <https-url>         Fetch source content from a URL
  --source <text>           Source text to evaluate against
  --source-file <path>      Load source text from a file
  --summary <text>          Summary text to evaluate
  --summary-file <path>     Load summary text from a file
  --max-words <number>      Word limit for agent-generated summary (default: 150)
  --skip-agent              Do not generate summary with the agent
  --json                    Print JSON result
  --compact                 Emit compact one-line JSON (use with --json)
  --help                    Show this help

Examples:
  npx -y node@23 --env-file=../.env mastra/evals/runSummaryEval.ts --url https://mastra.ai/
  npx -y node@23 --env-file=../.env mastra/evals/runSummaryEval.ts --source-file ./article.txt --summary-file ./summary.txt
  npx -y node@23 --env-file=../.env mastra/evals/runSummaryEval.ts --url https://mastra.ai/ --json --compact
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    maxWords: 150,
    skipAgent: false,
    json: false,
    compact: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--') {
      continue;
    }

    switch (arg) {
      case '--url':
        options.url = next;
        i += 1;
        break;
      case '--source':
        options.source = next;
        i += 1;
        break;
      case '--source-file':
        options.sourceFile = next;
        i += 1;
        break;
      case '--summary':
        options.summary = next;
        i += 1;
        break;
      case '--summary-file':
        options.summaryFile = next;
        i += 1;
        break;
      case '--max-words': {
        const parsed = Number(next);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('--max-words must be a positive number');
        }
        options.maxWords = parsed;
        i += 1;
        break;
      }
      case '--skip-agent':
        options.skipAgent = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--compact':
        options.compact = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function readOptionalFile(filePath?: string): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }
  const resolvedPath = path.resolve(process.cwd(), filePath);
  return fs.readFile(resolvedPath, 'utf-8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const sourceFromFile = await readOptionalFile(options.sourceFile);
  const summaryFromFile = await readOptionalFile(options.summaryFile);

  let title = 'Custom Source';
  let sourceText = options.source ?? sourceFromFile;

  if (options.url) {
    const fetched = await fetchPageTool.execute({ url: options.url });
    sourceText = sourceText ?? fetched.content;
    title = fetched.title;
  }

  if (!sourceText) {
    throw new Error('Provide source text using --url, --source, or --source-file');
  }

  let summaryText = options.summary ?? summaryFromFile;

  if (!summaryText && !options.skipAgent) {
    const prompt = options.url
      ? `Summarize ${options.url} in bullet points under ${options.maxWords} words.`
      : `Summarize the following content in bullet points under ${options.maxWords} words:\n\n${sourceText}`;

    const response = await summarizerAgent.generate(prompt);
    summaryText = response.text;
  }

  if (!summaryText) {
    throw new Error('No summary available. Provide --summary/--summary-file or omit --skip-agent.');
  }

  const evalResults = await runEvals(sourceText, summaryText, { silent: options.json });

  const payload = {
    title,
    url: options.url,
    summary: summaryText,
    evals: evalResults,
  };

  if (options.json) {
    console.log(options.compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
    return;
  }

  console.log('\n=== Summary Eval Report ===');
  console.log(`Title: ${payload.title}`);
  if (payload.url) {
    console.log(`URL: ${payload.url}`);
  }
  console.log('\nSummary:\n');
  console.log(payload.summary);
  console.log('\nScores:\n');
  for (const result of payload.evals) {
    console.log(`- ${result.metric}: ${result.score} (${result.reason})`);
  }
}

main().catch((error) => {
  console.error('\nSummary eval failed:');
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
