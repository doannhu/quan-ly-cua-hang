import { connectMongo } from './mongo.js';

// Add more drivers here (e.g. DynamoDB, Firestore) returning the same repo shape.
const drivers = { mongo: connectMongo };

export async function connectDb(config) {
  const driver = drivers[config.dbDriver];
  if (!driver) throw new Error(`Unknown DB_DRIVER "${config.dbDriver}"`);
  return driver(config);
}
