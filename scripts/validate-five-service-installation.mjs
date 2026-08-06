#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { composeEnvironment, validateInstallationInput } from './lib/five-service-installation.mjs';

const file = process.argv[2] ?? process.env.UNIFY_INSTALLATION_INPUT_FILE;
if (!file) throw new Error('Installation input file argument is required');
const input = validateInstallationInput(JSON.parse(readFileSync(file, 'utf8')));
console.log(
  JSON.stringify({
    schemaVersion: input.schemaVersion,
    valid: true,
    composeEnvironment: composeEnvironment(input),
  }),
);
