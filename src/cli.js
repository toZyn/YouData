#!/usr/bin/env node
import readline from 'node:readline';
import { open } from './index.js';

const args = process.argv.slice(2);
const file = args[1] && !args[1].startsWith('-') ? args[1] : './youdata.ydb';
const db = open(file);
const command = args[0];
const output = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);

if (command === 'init') output({ ok: true, file: db.file, version: db.meta.version });
else if (command === 'stats') output(db.stats());
else if (command === 'metrics') output(db.metricsSnapshot());
else if (command === 'compact') output({ ok: true, bytes: db.compact() });
else if (command === 'checkpoint') { db.checkpoint(); output({ ok: true }); }
else if (command === 'backup') {
  const dest = args[2] || `${file}.backup`;
  output(db.backup(dest));
} else if (command === 'account') {
  const [action, username, password, role] = args.slice(1);
  if (action === 'create') output(db.createAccount(username, password, role));
  else output({ error: 'Usage: youdata account create <username> <password> [role]' });
} else if (command === 'schema') {
  const [action, collection, json] = args.slice(1);
  if (action === 'set' && collection && json) {
    db.setSchema(collection, json === 'null' ? null : JSON.parse(json));
    output({ ok: true });
  } else if (action === 'get' && collection) {
    output(db.getSchema(collection) || null);
  } else output({ error: 'Usage: youdata schema set|get <collection> [schema-json|null]' });
} else if (command === 'index') {
  const [action, collection, field] = args.slice(1);
  if (action === 'create' && collection && field) {
    db.collection(collection).createIndex(field);
    output({ ok: true });
  } else if (action === 'drop' && collection && field) {
    db.collection(collection).dropIndex(field);
    output({ ok: true });
  } else if (action === 'list' && collection) {
    output(db.collection(collection).listIndexes());
  } else output({ error: 'Usage: youdata index create|drop|list <collection> [field]' });
} else if (command === 'gateway') {
  const port = Number(args[2] || 6380);
  const opts = { port };
  if (args.includes('--resp')) opts.resp = true;
  db.gateway(opts).start();
  output(`YouData Gateway listening on http://127.0.0.1:${port}${opts.resp ? ' (RESP)' : ''}`);
} else if (command === 'shell' || !command) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'youdata> ' });
  output('YouData v2 shell. Commands: stats, compact, checkpoint, metrics, backup <dest>,');
  output('  get <col> <key>, set <col> <key> <json>, del <col> <key>,');
  output('  find <col> [--query \'{"f":"v"}\'] [--sort \'{"f":"asc"}\'] [--limit N] [--skip N],');
  output('  schema set|get <col> [json], index create|drop|list <col> [field], exit');
  rl.prompt();
  rl.on('line', line => {
    const parts = line.trim().split(' ');
    const action = parts[0];
    try {
      if (action === 'stats') output(db.stats());
      else if (action === 'metrics') output(db.metricsSnapshot());
      else if (action === 'compact') output({ ok: true, bytes: db.compact() });
      else if (action === 'checkpoint') { db.checkpoint(); output({ ok: true }); }
      else if (action === 'backup') output(db.backup(parts[1] || `${db.file}.backup`));
      else if (action === 'get') output(db.collection(parts[1]).get(parts[2]));
      else if (action === 'del') output(db.collection(parts[1]).delete(parts[2]));
      else if (action === 'set') {
        const valStart = line.indexOf(parts[3]);
        output({ ok: Boolean(db.collection(parts[1]).set(parts[2], JSON.parse(line.slice(valStart)))) });
      } else if (action === 'find') {
        const col = db.collection(parts[1]);
        const query = {};
        const opts = {};
        for (let i = 2; i < parts.length; i++) {
          if (parts[i] === '--query') query.$merge = JSON.parse(parts[++i]);
          else if (parts[i] === '--sort') opts.sort = JSON.parse(parts[++i]);
          else if (parts[i] === '--limit') opts.limit = parseInt(parts[++i], 10);
          else if (parts[i] === '--skip') opts.skip = parseInt(parts[++i], 10);
        }
        output(col.find(query.$merge || {}, opts));
      } else if (action === 'schema') {
        if (parts[1] === 'set') {
          const json = line.slice(line.indexOf(parts[3]));
          db.setSchema(parts[2], JSON.parse(json));
          output({ ok: true });
        } else if (parts[1] === 'get') output(db.getSchema(parts[2]) || null);
        else output('Usage: schema set|get <col> [json]');
      } else if (action === 'index') {
        if (parts[1] === 'create') { db.collection(parts[2]).createIndex(parts[3]); output({ ok: true }); }
        else if (parts[1] === 'drop') { db.collection(parts[2]).dropIndex(parts[3]); output({ ok: true }); }
        else if (parts[1] === 'list') output(db.collection(parts[2]).listIndexes());
        else output('Usage: index create|drop|list <col> [field]');
      } else if (action === 'exit' || action === 'quit') return rl.close();
      else output('Unknown command');
    } catch (error) { output({ error: error.message }); }
    rl.prompt();
  });
} else output('Usage: youdata [init|stats|metrics|compact|checkpoint|backup|account|schema|index|gateway|shell] [file]');
