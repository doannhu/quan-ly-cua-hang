const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
};

export const config = {
  port: Number(process.env.PORT || 4000),
  dbDriver: process.env.DB_DRIVER || 'mongo',
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017',
  mongoDb: process.env.MONGO_DB || 'store_app',
  adminPassword: required('ADMIN_PASSWORD'),
  jwtSecret: required('JWT_SECRET'),
  aiApiKey: process.env.AI_API_KEY || '',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  timezone: process.env.TZ || 'Asia/Ho_Chi_Minh',
};
