// Copy every collection from MongoDB into a SQLite file, keeping document ids.
// Usage: MONGO_URI=mongodb://localhost:27017 MONGO_DB=store_app SQLITE_PATH=./data/store.db \
//        node scripts/migrate-mongo-to-sqlite.js
import { MongoClient } from 'mongodb';
import { connectSqlite } from '../src/db/sqlite.js';

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017';
const mongoDb = process.env.MONGO_DB || 'store_app';
const sqlitePath = process.env.SQLITE_PATH || './data/store.db';

const client = await MongoClient.connect(mongoUri);
const repos = await connectSqlite({ sqlitePath });
for (const name of ['users', 'stores', 'counters', 'reports']) {
  const docs = await client.db(mongoDb).collection(name).find().toArray();
  for (const { _id, ...data } of docs) repos[name].insertRaw(String(_id), data);
  console.log(`${name}: ${docs.length}`);
}
await client.close();
console.log(`Done -> ${sqlitePath}`);
