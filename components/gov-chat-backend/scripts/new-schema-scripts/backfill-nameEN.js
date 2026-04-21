/**
 * backfill-nameEN.js
 *
 * Backfills the `nameEN` field on `serviceCategories` and `services` documents
 * from their corresponding English translations in `serviceCategoryTranslations`
 * and `serviceTranslations` collections.
 *
 * This is needed because the service layer was creating categories and services
 * without setting `nameEN` on the parent documents — names were stored only in
 * the translation collections. The query engine requires `nameEN` on the
 * document to resolve category/service context.
 *
 * This script is idempotent — safe to run multiple times.
 *
 * Usage:
 *   node backfill-nameEN.js
 *
 * Environment Variables (in .env file):
 * - ARANGO_URL: ArangoDB URL (default: http://localhost:8529)
 * - ARANGO_DATABASE: Database name (default: genie-ai)
 * - ARANGO_USERNAME: ArangoDB username (default: root)
 * - ARANGO_PASSWORD: ArangoDB password (default: test)
 *
 * Prerequisites:
 * - The target database and collections must already exist.
 * - Install dependencies: `npm install arangojs dotenv`
 */

const { Database, aql } = require('arangojs');
require('dotenv').config();

async function main() {
  const dbConfig = {
    url: process.env.ARANGO_URL || 'http://localhost:8529',
    databaseName: process.env.ARANGO_DATABASE || 'genie-ai',
    auth: {
      username: process.env.ARANGO_USERNAME || 'root',
      password: process.env.ARANGO_PASSWORD || 'test'
    }
  };

  console.log('--- Backfill nameEN Migration Script ---');
  console.log(`Database: ${dbConfig.url}/${dbConfig.databaseName}`);

  const db = new Database(dbConfig);

  try {
    await db.get();
    console.log('Connected to ArangoDB successfully');
  } catch (error) {
    console.error(`Failed to connect to ArangoDB: ${error.message}`);
    process.exit(1);
  }

  const serviceCategories = db.collection('serviceCategories');
  const services = db.collection('services');

  try {
    await serviceCategories.exists();
    await services.exists();
    console.log('Required collections found');
  } catch (error) {
    console.error(`Required collections missing: ${error.message}`);
    process.exit(1);
  }

  // Backfill serviceCategories.nameEN
  console.log('\n=== Backfilling serviceCategories.nameEN ===');
  try {
    const cursor = await db.query(aql`
      FOR cat IN serviceCategories
        LET translation = FIRST(
          FOR trans IN serviceCategoryTranslations
            FILTER trans.serviceCategoryId == cat._key
            FILTER trans.languageCode == 'EN'
            RETURN trans.translation
        )
        FILTER cat.nameEN == null OR cat.nameEN != translation
        RETURN { _key: cat._key, nameEN: translation }
    `);
    const categories = await cursor.all();

    if (categories.length === 0) {
      console.log('All serviceCategories already have nameEN set correctly');
    } else {
      for (const cat of categories) {
        await serviceCategories.update(cat._key, { nameEN: cat.nameEN });
        console.log(`  Updated category ${cat._key}: nameEN = "${cat.nameEN}"`);
      }
      console.log(`Updated ${categories.length} serviceCategories`);
    }
  } catch (error) {
    console.error(`Error backfilling serviceCategories: ${error.message}`);
  }

  // Backfill services.nameEN
  console.log('\n=== Backfilling services.nameEN ===');
  try {
    const cursor = await db.query(aql`
      FOR svc IN services
        LET translation = FIRST(
          FOR trans IN serviceTranslations
            FILTER trans.serviceId == svc._key
            FILTER trans.languageCode == 'EN'
            RETURN trans.translation
        )
        FILTER svc.nameEN == null OR svc.nameEN != translation
        RETURN { _key: svc._key, nameEN: translation }
    `);
    const serviceList = await cursor.all();

    if (serviceList.length === 0) {
      console.log('All services already have nameEN set correctly');
    } else {
      for (const svc of serviceList) {
        await services.update(svc._key, { nameEN: svc.nameEN });
        console.log(`  Updated service ${svc._key}: nameEN = "${svc.nameEN}"`);
      }
      console.log(`Updated ${serviceList.length} services`);
    }
  } catch (error) {
    console.error(`Error backfilling services: ${error.message}`);
  }

  console.log('\n=== Backfill complete ===');
  process.exit(0);
}

main();
