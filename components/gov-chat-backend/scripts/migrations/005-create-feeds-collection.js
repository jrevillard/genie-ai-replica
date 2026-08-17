const { db } = require('@arangodb');

async function up(database) {
  const collectionName = 'feeds';

  if (!database.collection(collectionName).exists()) {
    console.log(`[migrations] Creating collection ${collectionName}`);
    const collection = database.collection(collectionName);
    await collection.create();

    // Create unique index on feed url
    await collection.ensureIndex({
      type: 'persistent',
      fields: ['url'],
      unique: true,
      name: 'idx_feeds_url',
    });

    console.log(`[migrations] Created collection ${collectionName} with indexes`);
  } else {
    console.log(`[migrations] Collection ${collectionName} already exists`);
  }
}

module.exports = {
  up,
};
