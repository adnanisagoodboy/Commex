const mongoose = require('mongoose');

// Plain Map — no cloning, just stores the connection reference directly
const connectionMap = new Map();

async function connectDB() {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/commex', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(` Main DB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(' Main DB connection failed:', err.message);
    process.exit(1);
  }
}

async function getOrgConnection(orgId, connectionString) {
  const tag = `[DB:${orgId.slice(-6)}]`;

  const cached = connectionMap.get(orgId);
  if (cached) {
    if (cached.readyState === 1) {
      console.log(`${tag} Reusing cached connection (readyState=1)`);
      return cached;
    }
    console.warn(`${tag} Stale connection (readyState=${cached.readyState}), reconnecting...`);
    connectionMap.delete(orgId);
    try { await cached.close(); } catch (_) {}
  }

  console.log(`${tag} Opening new connection...`);

  const conn = mongoose.createConnection(connectionString, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 10000,
  });

  await new Promise((resolve, reject) => {
    conn.once('open', () => {
      console.log(`${tag} Connected successfully`);
      resolve();
    });
    conn.once('error', (err) => {
      console.error(`${tag} Connection error:`, err.message);
      reject(err);
    });
    setTimeout(() => reject(new Error(`${tag} Timed out after 10s`)), 10000);
  });

  conn.on('disconnected', () => {
    console.warn(`${tag} Disconnected — removing from cache`);
    connectionMap.delete(orgId);
  });
  conn.on('error', (err) => {
    console.error(`${tag} Runtime error:`, err.message);
  });

  connectionMap.set(orgId, conn);
  return conn;
}

async function testOrgConnection(connectionString) {
  let testConn;
  try {
    testConn = mongoose.createConnection(connectionString, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 8000,
    });
    await new Promise((resolve, reject) => {
      testConn.once('open', resolve);
      testConn.once('error', reject);
      setTimeout(() => reject(new Error('Timed out after 8s')), 8000);
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    if (testConn) await testConn.close().catch(() => {});
  }
}

function invalidateOrgConnection(orgId) {
  connectionMap.delete(orgId);
}

module.exports = { connectDB, getOrgConnection, testOrgConnection, invalidateOrgConnection };
