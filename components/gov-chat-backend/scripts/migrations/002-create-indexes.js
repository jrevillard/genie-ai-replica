"use strict";

/**
 * 002-create-indexes.js
 *
 * Creates all indexes required by GENIE.AI services.
 * Idempotent — uses named indexes, so re-running is safe.
 */

module.exports = {
  async up(db) {
    const indexDefs = [
      // users
      {
        collection: "users",
        type: "persistent",
        fields: ["iss_sub"],
        unique: true,
        sparse: true,
        name: "idx_users_iss_sub_unique",
      },
      {
        collection: "users",
        type: "persistent",
        fields: ["email"],
        unique: false,
        sparse: true,
        name: "idx_users_email",
      },

      // sessions
      {
        collection: "sessions",
        type: "persistent",
        fields: ["active", "lastActiveTime"],
        name: "idx-active-lastActiveTime",
      },

      // conversationFiles
      {
        collection: "conversationFiles",
        type: "persistent",
        fields: ["conversationId"],
        name: "idx_conversationFiles_conversationId",
      },

      // serviceCategoryTranslations
      {
        collection: "serviceCategoryTranslations",
        type: "hash",
        fields: ["serviceCategoryId", "languageCode"],
        unique: true,
        name: "idx_serviceCategory_language",
      },
      {
        collection: "serviceCategoryTranslations",
        type: "skiplist",
        fields: ["serviceCategoryId"],
        name: "idx_serviceCategoryId",
      },
      {
        collection: "serviceCategoryTranslations",
        type: "skiplist",
        fields: ["languageCode"],
        name: "idx_languageCode_sct",
      },
      {
        collection: "serviceCategoryTranslations",
        type: "skiplist",
        fields: ["createdAt"],
        name: "idx_createdAt_sct",
      },

      // serviceTranslations
      {
        collection: "serviceTranslations",
        type: "hash",
        fields: ["serviceId", "languageCode"],
        unique: true,
        name: "idx_service_language",
      },
      {
        collection: "serviceTranslations",
        type: "skiplist",
        fields: ["serviceId"],
        name: "idx_serviceId_st",
      },
      {
        collection: "serviceTranslations",
        type: "skiplist",
        fields: ["languageCode"],
        name: "idx_languageCode_st",
      },
      {
        collection: "serviceTranslations",
        type: "skiplist",
        fields: ["createdAt"],
        name: "idx_createdAt_st",
      },

      // services
      {
        collection: "services",
        type: "hash",
        fields: ["categoryId", "order"],
        unique: false,
        name: "idx_categoryId_order",
      },
      {
        collection: "services",
        type: "skiplist",
        fields: ["createdAt"],
        name: "idx_createdAt_services",
      },

      // ingestion_log
      {
        collection: "ingestion_log",
        type: "persistent",
        fields: ["file_id"],
        name: "idx_ingestion_log_file_id",
      },
      {
        collection: "ingestion_log",
        type: "persistent",
        fields: ["timestamp"],
        name: "idx_ingestion_log_timestamp",
      },

      // crawl_job (document-repository)
      {
        collection: "crawl_job",
        type: "persistent",
        fields: ["file_id"],
        unique: true,
        name: "idx_crawl_job_file_id",
      },
      {
        collection: "crawl_job",
        type: "persistent",
        fields: ["status"],
        name: "idx_crawl_job_status",
      },

      // crawl_log (document-repository)
      {
        collection: "crawl_log",
        type: "persistent",
        fields: ["file_id"],
        name: "idx_crawl_log_file_id",
      },
      {
        collection: "crawl_log",
        type: "persistent",
        fields: ["timestamp"],
        name: "idx_crawl_log_timestamp",
      },

      // crawl_metrics (document-repository)
      {
        collection: "crawl_metrics",
        type: "persistent",
        fields: ["file_id"],
        unique: true,
        name: "idx_crawl_metrics_file_id",
      },
    ];

    for (const idx of indexDefs) {
      try {
        const collection = db.collection(idx.collection);
        await collection.ensureIndex({
          type: idx.type,
          fields: idx.fields,
          unique: idx.unique || false,
          sparse: idx.sparse || false,
          name: idx.name,
        });
        console.log(`  Ensured index: ${idx.collection}.${idx.name}`);
      } catch (err) {
        console.error(
          `  Error creating index ${idx.collection}.${idx.name}: ${err.message}`,
        );
        throw err;
      }
    }
  },
};
