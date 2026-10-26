import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Same repository contract as mongo.js, stored as JSON documents:
//   one table per collection: (id TEXT PRIMARY KEY, data TEXT) — fields queried with json_extract.
// Filters: plain equality (null matches missing/null), plus {field: {$gte, $lte}} for ranges.
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;
const col = (f) => {
  if (!FIELD.test(f)) throw new Error(`Invalid field name "${f}"`);
  return `json_extract(data, '$.${f}')`;
};
const val = (v) => (typeof v === 'boolean' ? Number(v) : v);

function where(filter) {
  const parts = [];
  const args = [];
  for (const [k, v] of Object.entries(filter)) {
    if (v === null || v === undefined) {
      parts.push(`${col(k)} IS NULL`);
    } else if (typeof v === 'object') {
      if (v.$gte !== undefined) { parts.push(`${col(k)} >= ?`); args.push(val(v.$gte)); }
      if (v.$lte !== undefined) { parts.push(`${col(k)} <= ?`); args.push(val(v.$lte)); }
    } else {
      parts.push(`${col(k)} = ?`);
      args.push(val(v));
    }
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', args };
}

class SqliteRepo {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  }
  static out(row) {
    return row ? { id: row.id, ...JSON.parse(row.data) } : null;
  }
  async insert(doc) {
    const id = randomUUID();
    const full = { ...doc, createdAt: new Date().toISOString() };
    this.db.prepare(`INSERT INTO ${this.table} (id, data) VALUES (?, ?)`).run(id, JSON.stringify(full));
    return { id, ...full };
  }
  async get(id) {
    return SqliteRepo.out(this.db.prepare(`SELECT id, data FROM ${this.table} WHERE id = ?`).get(id));
  }
  async find(filter = {}, { sort, limit, skip } = {}) {
    const w = where(filter);
    let sql = `SELECT id, data FROM ${this.table} ${w.sql}`;
    if (sort) sql += ' ORDER BY ' + Object.entries(sort).map(([k, d]) => `${col(k)} ${d < 0 ? 'DESC' : 'ASC'}`).join(', ');
    if (limit || skip) sql += ` LIMIT ${Number(limit) || -1} OFFSET ${Number(skip) || 0}`;
    return this.db.prepare(sql).all(...w.args).map(SqliteRepo.out);
  }
  async update(id, patch) {
    const cur = await this.get(id);
    if (!cur) return null;
    const { id: _id, ...data } = { ...cur, ...patch };
    this.db.prepare(`UPDATE ${this.table} SET data = ? WHERE id = ?`).run(JSON.stringify(data), id);
    return { id, ...data };
  }
  async remove(id) {
    return this.db.prepare(`DELETE FROM ${this.table} WHERE id = ?`).run(id).changes > 0;
  }
  async removeMany(filter) {
    const w = where(filter);
    this.db.prepare(`DELETE FROM ${this.table} ${w.sql}`).run(...w.args);
  }
  // Used by the Mongo -> SQLite migration script to keep existing ids.
  insertRaw(id, data) {
    this.db.prepare(`INSERT OR REPLACE INTO ${this.table} (id, data) VALUES (?, ?)`).run(id, JSON.stringify(data));
  }
}

export async function connectSqlite({ sqlitePath }) {
  mkdirSync(dirname(sqlitePath), { recursive: true });
  const db = new DatabaseSync(sqlitePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const repos = {
    users: new SqliteRepo(db, 'users'),
    stores: new SqliteRepo(db, 'stores'),
    counters: new SqliteRepo(db, 'counters'),
    reports: new SqliteRepo(db, 'reports'),
    // system stock imported from PMV (one document per store + date)
    snapshots: new SqliteRepo(db, 'snapshots'),
  };
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_nameKey ON users (json_extract(data, '$.nameKey'));
    CREATE INDEX IF NOT EXISTS reports_date_shift ON reports (json_extract(data, '$.date'), json_extract(data, '$.shift'));
    CREATE INDEX IF NOT EXISTS counters_store ON counters (json_extract(data, '$.storeId'));
  `);
  return repos;
}
