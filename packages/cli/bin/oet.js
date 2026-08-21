#!/usr/bin/env node
import { main } from "../src/cli.js";
main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(error?.message ?? String(error));
  process.exitCode = error?.exitCode ?? 2;
});
