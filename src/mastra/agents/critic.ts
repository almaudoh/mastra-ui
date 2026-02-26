import { Agent } from '@mastra/core/agent';

export const criticAgent = new Agent({
  id: 'critic',
  name: 'Summary Critic',
  instructions: `
    You are a strict editorial critic. You receive a summary and evaluate it on:
    - Accuracy: does it reflect the source content faithfully?
    - Conciseness: is it under 150 words?
    - Clarity: is it easy to understand?

    Respond with JSON in this exact format:
    {
      "score": <0-10>,
      "issues": ["<issue 1>", "..."],
      "suggestion": "<one-line improvement>"
    }
  `,
  model: 'openrouter/nvidia/nemotron-3-nano-30b-a3b:free',
});
