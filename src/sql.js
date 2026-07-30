function splitList(text) {
  const parts = [];
  let current = '';
  let quote = null;
  for (const char of text) {
    if (quote) { current += char; if (char === quote) quote = null; continue; }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    if (char === ',') { parts.push(current.trim()); current = ''; } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function valueOf(value) {
  const v = value.trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) return v.slice(1, -1);
  if (v === 'NULL') return null;
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  if (Number.isFinite(Number(v))) return Number(v);
  throw new SyntaxError(`Unsupported SQL value: ${v}`);
}

function condition(text) {
  if (!text) return () => true;
  const match = text.trim().match(/^([A-Za-z_][\w]*)\s*(=|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) throw new SyntaxError('WHERE supports column comparisons only');
  const [, field, operator, raw] = match;
  const expected = valueOf(raw);
  return row => ({ '=': row[field] === expected, '!=': row[field] !== expected, '>': row[field] > expected, '<': row[field] < expected, '>=': row[field] >= expected, '<=': row[field] <= expected }[operator]);
}

export class SQLDatabase {
  constructor(db) { this.db = db; }

  execute(statement) {
    const sql = statement.trim().replace(/;$/, '');
    let match = sql.match(/^SELECT\s+(.+?)\s+FROM\s+([A-Za-z_][\w]*)(?:\s+WHERE\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i);
    if (match) {
      const [, fields, collection, where, limit] = match;
      let rows = this.db.collection(collection).find({}, {});
      rows = rows.filter(condition(where));
      if (limit) rows = rows.slice(0, Number(limit));
      if (fields.trim() !== '*') { const selected = fields.split(',').map(v => v.trim()); rows = rows.map(row => Object.fromEntries(selected.map(field => [field, row[field]]))); }
      return { rows, count: rows.length };
    }
    match = sql.match(/^INSERT\s+INTO\s+([A-Za-z_][\w]*)\s*\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)$/i);
    if (match) { const [, collection, fields, values] = match; const row = Object.fromEntries(splitList(fields).map((field, i) => [field.trim(), valueOf(splitList(values)[i])])); const key = this.db.collection(collection).addWithKey(row); return { key, affectedRows: 1 }; }
    match = sql.match(/^UPDATE\s+([A-Za-z_][\w]*)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
    if (match) { const [, collection, assignments, where] = match; const col = this.db.collection(collection); const changes = Object.fromEntries(splitList(assignments).map(pair => { const [field, value] = pair.split(/=(.*)/s); return [field.trim(), valueOf(value)]; })); let affectedRows = 0; for (const [key, row] of col.entries()) if (condition(where)(row)) { col.set(key, { ...row, ...changes }); affectedRows++; } return { affectedRows }; }
    match = sql.match(/^DELETE\s+FROM\s+([A-Za-z_][\w]*)(?:\s+WHERE\s+(.+))?$/i);
    if (match) { const [, collection, where] = match; const col = this.db.collection(collection); let affectedRows = 0; for (const [key, row] of col.entries()) if (condition(where)(row)) { col.delete(key); affectedRows++; } return { affectedRows }; }
    throw new SyntaxError('Supported SQL: SELECT, INSERT, UPDATE, DELETE');
  }
}
