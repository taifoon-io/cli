#!/usr/bin/env node
// taifoon — see src/main.mjs
import { main } from '../src/main.mjs';

process.exitCode = await main(process.argv.slice(2));
