export type SummaryEvalResult = {
  metric: 'conciseness' | 'coverage' | 'toxicity';
  score: number;
  reason: string;
};

type RunEvalsOptions = {
  silent?: boolean;
};

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

export async function runEvals(
  sourceText: string,
  summary: string,
  options: RunEvalsOptions = {}
): Promise<SummaryEvalResult[]> {
  const sourceTokens = new Set(tokenize(sourceText));
  const summaryTokens = tokenize(summary);

  const wordCount = summaryTokens.length;
  const concisenessScore = wordCount <= 150 ? 1 : Math.max(0, 1 - (wordCount - 150) / 300);

  const overlapCount = summaryTokens.filter((token) => sourceTokens.has(token)).length;
  const coverageScore = summaryTokens.length === 0 ? 0 : overlapCount / summaryTokens.length;

  const banned = ['hate', 'kill', 'idiot', 'stupid'];
  const toxicHits = summaryTokens.filter((token) => banned.includes(token)).length;
  const toxicityScore = toxicHits === 0 ? 1 : Math.max(0, 1 - toxicHits / 5);

  const results: SummaryEvalResult[] = [
    {
      metric: 'conciseness',
      score: Number(concisenessScore.toFixed(2)),
      reason: `Summary length is ${wordCount} words (target: <= 150).`,
    },
    {
      metric: 'coverage',
      score: Number(coverageScore.toFixed(2)),
      reason: 'Approximate lexical overlap between source and summary.',
    },
    {
      metric: 'toxicity',
      score: Number(toxicityScore.toFixed(2)),
      reason: toxicHits === 0 ? 'No blocked terms detected.' : `Detected ${toxicHits} blocked term(s).`,
    },
  ];

  if (!options.silent) {
    results.forEach(({ metric, score, reason }) => {
      console.log(`[${metric}] Score: ${score} — ${reason}`);
    });
  }

  return results;
}
