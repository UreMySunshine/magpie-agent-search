import { names } from './config.js';
import { SearchError } from './errors.js';
import { parseFilters } from './filters.js';
import { maxResultCount } from './result-count.js';

export const taskTypes = ['general', 'code', 'news'];
export const maxInputLength = 4_000;
export const characterLimits = { minimum: 100, maximum: 50_000, default: 20_000 };

export function requestParameters({
  operation, input, taskType = 'general', limit = 5,
  maxChars = characterLimits.default, engine, filterOptions = {},
}) {
  if (typeof input !== 'string' || !input.trim() || input.length > maxInputLength) {
    throw new SearchError('USAGE', 'Supply one nonempty query or URL, up to 4000 characters');
  }
  if (!taskTypes.includes(taskType) || (engine !== undefined && !names.includes(engine))) {
    throw new SearchError('USAGE', 'Invalid task type or engine');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > maxResultCount ||
      !Number.isInteger(maxChars) || maxChars < characterLimits.minimum || maxChars > characterLimits.maximum) {
    throw new SearchError('USAGE', `Count must be an integer from 1 to ${maxResultCount} and max_chars from 100 to 50000`);
  }
  const filters = parseFilters(filterOptions, operation);
  return { operation, input, taskType, limit: operation === 'fetch' ? 1 : limit, maxChars, engine, filters };
}
