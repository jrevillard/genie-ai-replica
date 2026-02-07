package com.genieai.mobile.data.repository

import com.genieai.mobile.data.model.ServiceCategory
import com.genieai.mobile.data.remote.ApiService
import com.google.gson.JsonObject

object ServiceTreeRepository {

    suspend fun getAllCategories(locale: String = "en"): Result<List<ServiceCategory>> {
        return try {
            val response = ApiService.get("services/categories", mapOf("locale" to locale))
            if (response.isSuccess && response.body != null) {
                val categories = mutableListOf<ServiceCategory>()
                val array = response.body.getAsJsonArray("categories")
                    ?: response.body.getAsJsonArray("data")
                    ?: (if (response.body.isJsonArray) response.body.asJsonArray else null)
                array?.forEach { el ->
                    if (el.isJsonObject) categories.add(parseCategory(el.asJsonObject))
                }
                Result.success(categories)
            } else {
                Result.failure(Exception("Failed to load categories"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getCategoryServices(categoryId: String, locale: String = "en"): Result<List<ServiceCategory>> {
        return try {
            val response = ApiService.get(
                "services/categories/$categoryId/services",
                mapOf("locale" to locale)
            )
            if (response.isSuccess && response.body != null) {
                val services = mutableListOf<ServiceCategory>()
                val array = response.body.getAsJsonArray("services")
                    ?: response.body.getAsJsonArray("data")
                    ?: response.body.getAsJsonArray("children")
                    ?: (if (response.body.isJsonArray) response.body.asJsonArray else null)
                array?.forEach { el ->
                    if (el.isJsonObject) services.add(parseCategory(el.asJsonObject))
                }
                Result.success(services)
            } else {
                Result.failure(Exception("Failed to load services"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun searchServices(query: String, locale: String = "en"): Result<List<ServiceCategory>> {
        return try {
            val response = ApiService.get("services/search", mapOf(
                "query" to query,
                "locale" to locale
            ))
            if (response.isSuccess && response.body != null) {
                val results = mutableListOf<ServiceCategory>()
                val array = response.body.getAsJsonArray("results")
                    ?: response.body.getAsJsonArray("data")
                    ?: (if (response.body.isJsonArray) response.body.asJsonArray else null)
                array?.forEach { el ->
                    if (el.isJsonObject) results.add(parseCategory(el.asJsonObject))
                }
                Result.success(results)
            } else {
                Result.failure(Exception("Search failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Extract ID: backend uses catKey, _key, key, or id depending on endpoint */
    private fun extractId(obj: JsonObject): String {
        obj.get("catKey")?.asString?.let { if (it.isNotEmpty()) return it }
        obj.get("_key")?.asString?.let { if (it.isNotEmpty()) return it }
        obj.get("key")?.asString?.let { if (it.isNotEmpty()) return it }
        return obj.get("id")?.asString ?: ""
    }

    /** Extract name: backend uses nameEN, name, or label */
    private fun extractName(obj: JsonObject): String {
        obj.get("nameEN")?.let { if (!it.isJsonNull) return it.asString }
        obj.get("name")?.let { if (!it.isJsonNull) return it.asString }
        obj.get("label")?.let { if (!it.isJsonNull) return it.asString }
        return ""
    }

    private fun parseCategory(obj: JsonObject): ServiceCategory {
        val children = mutableListOf<ServiceCategory>()
        // Children can be objects (full data) or strings (just keys)
        (obj.getAsJsonArray("children") ?: obj.getAsJsonArray("services"))?.forEach { child ->
            if (child.isJsonObject) {
                children.add(parseCategory(child.asJsonObject))
            } else if (child.isJsonPrimitive) {
                // Child is a string key — create minimal category with just the ID
                children.add(ServiceCategory(id = child.asString, name = child.asString))
            }
        }

        return ServiceCategory(
            id = extractId(obj),
            name = extractName(obj),
            description = obj.get("description")?.let { if (!it.isJsonNull) it.asString else null }
                ?: obj.get("descriptionEN")?.let { if (!it.isJsonNull) it.asString else null },
            parentId = obj.get("parentId")?.let { if (!it.isJsonNull) it.asString else null },
            icon = obj.get("icon")?.let { if (!it.isJsonNull) it.asString else null },
            children = children
        )
    }
}
