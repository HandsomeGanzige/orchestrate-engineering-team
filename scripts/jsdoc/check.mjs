#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCE_ROOTS = Object.freeze([
  '.agents/skills/orchestrate-engineering-team/scripts',
  'scripts/agent-profiles',
  'scripts/jsdoc',
  'scripts/release',
]);
const CONTROL_FLOW_KEYWORDS = new Set(['catch', 'for', 'if', 'switch', 'while', 'with']);

/**
 * Recursively discovers JavaScript modules that belong to the maintained repository source.
 *
 * @param {string} directory - Absolute directory to traverse.
 * @returns {Promise<string[]>} Sorted absolute paths for maintained `.mjs` files.
 */
async function discoverSourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await discoverSourceFiles(candidate));
    else if (entry.name.endsWith('.mjs')) files.push(candidate);
  }
  return files.sort();
}

/**
 * Finds the JSDoc block immediately preceding a named function declaration.
 *
 * @param {string[]} lines - Complete source split into lines.
 * @param {number} functionLine - Zero-based line containing the function declaration.
 * @returns {string|null} Complete JSDoc text, or `null` when no adjacent block exists.
 */
function precedingJsdoc(lines, functionLine) {
  let end = functionLine - 1;
  while (end >= 0 && lines[end].trim() === '') end -= 1;
  if (end < 0 || lines[end].trim() !== '*/') return null;
  let start = end;
  while (start >= 0 && !lines[start].trim().startsWith('/**')) start -= 1;
  if (start < 0) return null;
  return lines.slice(start, end + 1).join('\n');
}

/**
 * Counts top-level parameters in a function signature while respecting nested defaults and strings.
 *
 * @param {string} source - Complete module source.
 * @param {number} openingParenthesis - Offset of the signature's opening parenthesis.
 * @returns {number} Number of top-level parameters declared by the function.
 */
function countParameters(source, openingParenthesis) {
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;
  let quote = '';
  let escaped = false;
  let parameterHasContent = false;
  let parameterCount = 0;
  for (let index = openingParenthesis; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (['"', "'", '`'].includes(character)) {
      quote = character;
      continue;
    }
    if (character === '(') {
      roundDepth += 1;
      continue;
    }
    if (character === ')') {
      roundDepth -= 1;
      if (roundDepth === 0) return parameterCount + (parameterHasContent ? 1 : 0);
      continue;
    }
    if (roundDepth !== 1) continue;
    if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth -= 1;
    else if (character === '{') curlyDepth += 1;
    else if (character === '}') curlyDepth -= 1;
    else if (character === ',' && squareDepth === 0 && curlyDepth === 0) {
      if (parameterHasContent) parameterCount += 1;
      parameterHasContent = false;
    } else if (!/\s/.test(character)) parameterHasContent = true;
  }
  return 0;
}

/**
 * Collects named function declarations that constitute the repository's documented code surface.
 *
 * @param {string} source - Complete JavaScript module source.
 * @returns {{name: string, line: number, parameterCount: number, constructor: boolean}[]} Function identities and documentation requirements.
 */
function collectNamedFunctions(source) {
  const lines = source.split('\n');
  const declarations = [];
  let lineOffset = 0;
  const patterns = [
    { regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\((.*)$/, constructor: false },
    { regex: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\((.*)\)\s*=>/, constructor: false },
    { regex: /^\s*constructor\s*\((.*)$/, constructor: true },
    { regex: /^\s+([A-Za-z_$][\w$]*)\s*\((.*)\)\s*\{$/, constructor: false },
  ];
  for (let line = 0; line < lines.length; line += 1) {
    for (const pattern of patterns) {
      const match = pattern.regex.exec(lines[line]);
      if (!match) continue;
      const name = pattern.constructor ? 'constructor' : match[1];
      if (CONTROL_FLOW_KEYWORDS.has(name)) continue;
      const openingParenthesis = lineOffset + lines[line].indexOf('(');
      declarations.push({
        name,
        line,
        parameterCount: countParameters(source, openingParenthesis),
        constructor: pattern.constructor,
      });
      break;
    }
    lineOffset += lines[line].length + 1;
  }
  return declarations;
}

/**
 * Validates JSDoc adjacency plus parameter and return documentation for one module.
 *
 * @param {string} file - Absolute module path.
 * @param {string} source - Complete module source.
 * @returns {string[]} Human-readable violations for the module.
 */
function validateFile(file, source) {
  const lines = source.split('\n');
  const relative = path.relative(PROJECT_ROOT, file);
  const errors = [];
  for (const declaration of collectNamedFunctions(source)) {
    const doc = precedingJsdoc(lines, declaration.line);
    const label = `${relative}:${declaration.line + 1} ${declaration.name}`;
    if (!doc) {
      errors.push(`${label} is missing adjacent JSDoc`);
      continue;
    }
    const contentLines = doc.split('\n')
      .map((line) => line.replace(/^\s*\/\*\*?\s?/, '').replace(/^\s*\*\/?\s?/, '').trim());
    const summary = contentLines.find((line) => line && !line.startsWith('@') && line !== '/');
    if (!summary) errors.push(`${label} does not include a functional summary`);
    const parameterLines = contentLines.filter((line) => line.startsWith('@param '));
    if (parameterLines.length !== declaration.parameterCount) {
      errors.push(`${label} documents ${parameterLines.length}/${declaration.parameterCount} parameters`);
    }
    if (parameterLines.some((line) => !line.includes(' - ') || !line.split(' - ')[1]?.trim())) {
      errors.push(`${label} has a parameter without a detailed description`);
    }
    const returnLines = contentLines.filter((line) => line.startsWith('@returns '));
    if (!declaration.constructor && returnLines.length !== 1) {
      errors.push(`${label} must document exactly one return value`);
    } else if (returnLines.some((line) => !/^@returns\s+\{.+\}\s+\S/.test(line))) {
      errors.push(`${label} has a return value without a detailed description`);
    }
  }
  return errors;
}

/**
 * Runs repository-wide named-function JSDoc validation and prints a concise summary.
 *
 * @returns {Promise<0|1>} Exit code indicating whether every named production function is documented.
 */
export async function main() {
  const files = (await Promise.all(
    SOURCE_ROOTS.map((root) => discoverSourceFiles(path.join(PROJECT_ROOT, root))),
  )).flat().sort();
  const errors = [];
  let functions = 0;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    functions += collectNamedFunctions(source).length;
    errors.push(...validateFile(file, source));
  }
  if (errors.length > 0) {
    errors.forEach((error) => console.error(error));
    return 1;
  }
  console.log(`JSDoc check passed: ${functions} named functions in ${files.length} modules.`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
