#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkAgentProfiles, formatDiagnostic } from "./checker.mjs";

const USAGE = "Usage: node scripts/agent-profiles/check.mjs [--root <path>]";

/**
 * Parses the checker's optional repository-root argument.
 *
 * @param {string[]} arguments_ - CLI arguments excluding executable and script path.
 * @returns {{root: string}|null} Resolved root options, or `null` for invalid usage.
 */
export function parseArguments(arguments_) {
  if (arguments_.length === 0) return { root: process.cwd() };
  if (
    arguments_.length === 2 &&
    arguments_[0] === "--root" &&
    arguments_[1].trim()
  ) {
    return { root: path.resolve(arguments_[1]) };
  }
  return null;
}

/**
 * Runs Agent Profile validation and prints deterministic diagnostics or a success summary.
 *
 * @param {string[]} [arguments_=process.argv.slice(2)] - CLI arguments excluding executable and script path.
 * @returns {Promise<0|1|2>} Process exit code for success, validation failure, or usage/runtime failure.
 */
export async function main(arguments_ = process.argv.slice(2)) {
  const options = parseArguments(arguments_);
  if (!options) {
    console.error(USAGE);
    return 2;
  }

  try {
    const result = await checkAgentProfiles(options.root);
    if (!result.ok) {
      for (const diagnostic of result.diagnostics) {
        console.error(formatDiagnostic(diagnostic));
      }
      console.error(`Agent Profile check failed with ${result.diagnostics.length} error(s).`);
      return 1;
    }
    const summary = result.summary;
    console.log(
      `Agent Profile check passed: ${summary.skills} Skills, ${summary.uiMetadataFiles} UI metadata files, ${summary.profiles} profiles, ${summary.returnContracts} return contracts.`,
    );
    return 0;
  } catch (error) {
    console.error(`Agent Profile check could not run: ${error?.message ?? String(error)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
