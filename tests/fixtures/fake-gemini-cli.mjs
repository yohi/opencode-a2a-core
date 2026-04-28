#!/usr/bin/env node
// Minimal Gemini-like JSON-lines emitter for integration tests.
import { stdin, stdout, exit } from 'node:process';

let buffer = '';

stdin.on('data', (chunk) => {
  buffer += chunk;
});

stdin.on('end', () => {
  stdout.write(`${JSON.stringify({ type: 'thinking', text: 'pondering' })}\n`);
  stdout.write(
    `${JSON.stringify({ type: 'text', text: `echo: ${buffer.trim()}` })}\n`
  );
  exit(0);
});
