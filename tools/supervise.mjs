#!/usr/bin/env node
/**
 * Tiny supervisor for the two long-lived services of the preview setup.
 *
 * `npm run preview` starts this twice — once for the relay, once for the Vite
 * dev server — so that a crash or an external kill can never leave the preview
 * half-dead. If the relay disappears, live rooms would stop working while the
 * page kept loading, which is exactly the confusing state this prevents.
 *
 * Usage: node tools/supervise.mjs <relay|web>
 */
import { spawn } from 'node:child_process';

const TARGETS = {
  relay: ['npx', ['tsx', 'server/index.ts']],
  web: ['npx', ['vite', '--config', 'client/vite.config.ts']],
};

const target = process.argv[2];
const command = TARGETS[target];

if (!command) {
  console.error(`supervise: unknown target "${target}" (expected relay or web)`);
  process.exit(2);
}

const [bin, args] = command;
let child = null;
let stopping = false;
let restarts = 0;

function start() {
  if (stopping) return;
  child = spawn(bin, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    restarts++;
    const how = signal ? `signal ${signal}` : `code ${code}`;
    console.log(`[supervise:${target}] exited with ${how} — restarting (restart #${restarts})`);
    setTimeout(start, 1500);
  });
  child.on('error', (err) => {
    console.error(`[supervise:${target}] could not start: ${err.message}`);
    setTimeout(start, 3000);
  });
}

function stop(signal) {
  stopping = true;
  console.log(`[supervise:${target}] ${signal} received — shutting down`);
  if (child && !child.killed) child.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('uncaughtException', (err) => console.error(`[supervise:${target}]`, err));

start();
