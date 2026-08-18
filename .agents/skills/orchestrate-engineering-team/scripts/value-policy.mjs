import path from 'node:path';

import { ensure } from './workflow-contract.mjs';

/**
 * Converts an optional scalar value to the canonical string representation used by workflow files.
 *
 * @param {unknown} value - Value to convert; `null` and `undefined` become an empty string.
 * @returns {string} The converted string, or an empty string for an absent value.
 */
export function scalar(value) {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Normalizes a string or string array into a bounded array of non-empty trimmed strings.
 *
 * @param {unknown} value - Comma-separated text or an array of strings to normalize.
 * @param {string} name - Human-readable field name used in validation errors.
 * @param {{min?: number, max?: number}} [bounds] - Inclusive item-count bounds.
 * @returns {string[]} A new array containing trimmed, non-empty strings.
 */
export function normalizeStrings(value, name, { min = 0, max = 100 } = {}) {
  if (typeof value === 'string') {
    value = value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  ensure(
    Array.isArray(value)
      && value.length >= min
      && value.length <= max
      && value.every((item) => typeof item === 'string' && item.trim()),
    `${name} must contain ${min}-${max} strings`,
    'INVALID_INPUT',
  );
  return value.map((item) => item.trim());
}

/**
 * Canonicalizes and validates a project-relative POSIX path used as a write scope.
 *
 * @param {unknown} scope - Candidate relative path using either slash convention.
 * @returns {string} A normalized path without a leading `./` or trailing slash.
 */
export function normalizedScope(scope) {
  ensure(
    typeof scope === 'string' && scope && !path.isAbsolute(scope),
    'write scope must be a relative path',
    'INVALID_SCOPE',
  );
  const normalized = path.posix.normalize(scope.replaceAll('\\', '/'))
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
  ensure(
    normalized !== '..' && !normalized.startsWith('../') && normalized !== '.',
    'write scope escapes the project',
    'INVALID_SCOPE',
  );
  return normalized;
}

/**
 * Requires a non-empty string whose length does not exceed a field-specific limit.
 *
 * @param {unknown} value - Candidate string value.
 * @param {string} field - Field label included in validation failures.
 * @param {number} [max=500] - Maximum permitted string length.
 * @returns {string} The validated string, unchanged.
 */
export function boundedString(value, field, max = 500) {
  ensure(
    typeof value === 'string' && value.length > 0 && value.length <= max,
    `${field} must be a non-empty string no longer than ${max}`,
    'INVALID_RESULT',
  );
  return value;
}
