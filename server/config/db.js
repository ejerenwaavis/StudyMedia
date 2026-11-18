const mongoose = require('mongoose');

let isConnected = false;

/**
 * Connect to MongoDB Atlas using MONGODB_URI.
 * Gracefully handles connection failures so the app remains operational
 * with client-side localStorage fallback.
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('[DB] MONGODB_URI not set. Running in localStorage-only mode.');
    return false;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log('[DB] Connected to MongoDB Atlas');
    return true;
  } catch (err) {
    isConnected = false;
    console.error('[DB] MongoDB connection error:', err.message);
    return false;
  }
}

function getDBStatus() {
  return isConnected && mongoose.connection.readyState === 1;
}

module.exports = { connectDB, getDBStatus };
