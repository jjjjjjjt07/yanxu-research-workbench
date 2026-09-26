export const DEFAULT_MODEL = 'deepseek-flash';
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export function modelConfig(env: {
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_DAILY_CALL_LIMIT?: string;
}) {
  return {
    configured: !!env.AI_API_KEY,
    model: env.AI_MODEL || DEFAULT_MODEL,
    baseUrl: env.AI_BASE_URL || DEFAULT_BASE_URL,
    dailyLimit: Math.max(1, Number(env.AI_DAILY_CALL_LIMIT) || 100),
  };
}
