#!/usr/bin/env node

/**
 * Server wrapper for Next.js standalone mode.
 * Generates runtime public configuration, then starts Next.js.
 */

const fs = require('fs');
const path = require('path');

const env = process.env;
const runtimeConfig = {};
const EXTRA_CLIENT_VARS = ['LEARNHOUSE_PLATFORM_URL'];

Object.keys(env).forEach((key) => {
  if (key.startsWith('NEXT_PUBLIC_') || EXTRA_CLIENT_VARS.includes(key)) {
    runtimeConfig[key] = env[key];
    process.env[key] = env[key];
  }
});

const configPath = path.join(__dirname, 'runtime-config.json');
fs.writeFileSync(configPath, JSON.stringify(runtimeConfig, null, 2), 'utf8');

const publicDir = path.join(__dirname, 'public');
try {
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  const scriptPath = path.join(publicDir, 'runtime-config.js');
  fs.writeFileSync(
    scriptPath,
    `window.__RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};`,
    'utf8'
  );
} catch {
  // Runtime JSON still supports server-side configuration if the public file
  // cannot be written.
}

if (!process.env.HOSTNAME) process.env.HOSTNAME = '0.0.0.0';

// Some production hosts reserve PORT for the public reverse proxy. NEXT_PORT
// lets the bundled Next.js service stay on its internal port while nginx owns
// the externally routed port.
process.env.PORT = process.env.NEXT_PORT || process.env.PORT || '3000';

require('./server.js');
