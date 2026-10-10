// Each driver returns the same repo shape: { users, stores, counters, reports }.
// Drivers are imported lazily so only the selected one's dependencies are loaded.
const drivers = {
  sqlite: async (c) => (await import('./sqlite.js')).connectSqlite(c),
  mongo: async (c) => (await import('./mongo.js')).connectMongo(c),
};

export async function connectDb(config) {
  const driver = drivers[config.dbDriver];
  if (!driver) throw new Error(`Unknown DB_DRIVER "${config.dbDriver}" (use: ${Object.keys(drivers).join(', ')})`);
  return driver(config);
}
