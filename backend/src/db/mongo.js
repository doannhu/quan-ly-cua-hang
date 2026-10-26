import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';

// Repository contract (implement this for any other database):
//   insert(doc) -> doc, get(id), find(filter, {sort, limit, skip}), update(id, patch), remove(id), removeMany(filter)
// Filters: plain equality, plus {field: {$gte, $lte}} for ranges.
class MongoRepo {
  constructor(col) {
    this.col = col;
  }
  static out(d) {
    if (!d) return null;
    const { _id, ...rest } = d;
    return { id: _id, ...rest };
  }
  async insert(doc) {
    const id = randomUUID();
    const full = { ...doc, createdAt: new Date().toISOString() };
    await this.col.insertOne({ _id: id, ...full });
    return { id, ...full };
  }
  async get(id) {
    return MongoRepo.out(await this.col.findOne({ _id: id }));
  }
  async find(filter = {}, { sort, limit, skip } = {}) {
    let cur = this.col.find(filter);
    if (sort) cur = cur.sort(sort);
    if (skip) cur = cur.skip(skip);
    if (limit) cur = cur.limit(limit);
    return (await cur.toArray()).map(MongoRepo.out);
  }
  async update(id, patch) {
    await this.col.updateOne({ _id: id }, { $set: patch });
    return this.get(id);
  }
  async remove(id) {
    const r = await this.col.deleteOne({ _id: id });
    return r.deletedCount > 0;
  }
  async removeMany(filter) {
    await this.col.deleteMany(filter);
  }
}

export async function connectMongo({ mongoUri, mongoDb }) {
  const client = new MongoClient(mongoUri);
  for (let i = 0; ; i++) {
    try {
      await client.connect();
      break;
    } catch (e) {
      if (i >= 30) throw e;
      console.log('Waiting for MongoDB...');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const db = client.db(mongoDb);
  await db.collection('users').createIndex({ nameKey: 1 }, { unique: true });
  await db.collection('reports').createIndex({ date: 1, shift: 1 });
  await db.collection('counters').createIndex({ storeId: 1 });
  return {
    users: new MongoRepo(db.collection('users')),
    stores: new MongoRepo(db.collection('stores')),
    counters: new MongoRepo(db.collection('counters')),
    reports: new MongoRepo(db.collection('reports')),
    snapshots: new MongoRepo(db.collection('snapshots')),
  };
}
