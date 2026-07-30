#!/usr/bin/env node
import readline from 'node:readline';
import { open } from './index.js';

const args = process.argv.slice(2);
const file = args[1] && !args[1].startsWith('-') ? args[1] : './youdata.ydb';
const db = open(file);
const command = args[0];
const output = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);

if (command === 'init') output({ ok: true, file: db.file });
else if (command === 'stats') output(db.stats());
else if (command === 'compact') output({ ok: true, bytes: db.compact() });
else if (command === 'account') {
  const [action, username, password, role] = args.slice(1);
  if (action === 'create') output(db.createAccount(username, password, role));
  else output({ error: 'Usage: youdata account create <username> <password> [role]' });
} else if (command === 'gateway') {
  const port = Number(args[2] || 6380);
  db.gateway({ port }).start();
  output(`YouData Gateway listening on http://127.0.0.1:${port}`);
} else if (command === 'shell' || !command) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'youdata> ' });
  output('YouData shell. Commands: stats, compact, get <collection> <key>, set <collection> <key> <json>, exit');
  rl.prompt();
  rl.on('line', line => {
    const [action, collection, key, ...rest] = line.trim().split(' ');
    try {
      if (action === 'stats') output(db.stats());
      else if (action === 'compact') output({ ok: true, bytes: db.compact() });
      else if (action === 'get') output(db.collection(collection).get(key));
      else if (action === 'set') output({ ok: Boolean(db.collection(collection).set(key, JSON.parse(rest.join(' ')))) });
      else if (action === 'exit' || action === 'quit') return rl.close();
      else output('Unknown command');
    } catch (error) { output({ error: error.message }); }
    rl.prompt();
  });
} else output('Usage: youdata [init|stats|compact|account|gateway|shell] [file]');
