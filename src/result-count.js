export const maxResultCount = 20;

const providerMaximums = {
  anysearch: 10,
  exa: 100,
  firecrawl: 100,
  keenable: 50,
  parallel: 20,
  querit: 20,
  tavily: 20,
  you: 100,
  yuanbao: 50,
};

export function resolveResultCount(requested, engine, { key, resultLimit }) {
  // The legacy anonymous You endpoint has no verified range beyond ten.
  const providerMax = engine === 'you' && !key ? 10 : providerMaximums[engine] ?? maxResultCount;
  return Math.min(requested, resultLimit ?? requested, providerMax);
}
