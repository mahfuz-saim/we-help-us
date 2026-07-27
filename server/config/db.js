/**
 * MongoDB connection helper.
 *
 * NOTE: Actual connection logic is wired up in Module 0.4 (MongoDB Connection).
 * This file currently only validates that MONGODB_URI is present in the
 * environment so the server can fail fast during boot in later modules.
 */

const mongoose = require('mongoose');

let connected = false;

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Copy server/.env.example to server/.env and fill it in.'
    );
  }

  if (connected) return mongoose.connection;

  // Mongoose 9 keeps these defaults sensible, but we set them explicitly
  // so behavior doesn't silently change across driver versions.
  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  connected = true;
  return mongoose.connection;
}

function isConnected() {
  return mongoose.connection.readyState === 1;
}

async function disconnectDB() {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

module.exports = { connectDB, isConnected, disconnectDB };