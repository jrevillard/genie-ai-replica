package com.genieai.mobile.data.repository

import com.genieai.mobile.data.remote.ApiService
import com.genieai.mobile.util.SHA256

object UserRepository {

    suspend fun getProfile(userId: String): Result<Map<String, Any?>> {
        return try {
            val response = ApiService.get("users/$userId")
            if (response.isSuccess && response.body != null) {
                val map = mutableMapOf<String, Any?>()
                response.body.entrySet().forEach { (key, value) ->
                    map[key] = when {
                        value.isJsonNull -> null
                        value.isJsonPrimitive -> {
                            val prim = value.asJsonPrimitive
                            when {
                                prim.isBoolean -> prim.asBoolean
                                prim.isNumber -> prim.asNumber
                                else -> prim.asString
                            }
                        }
                        else -> value.toString()
                    }
                }
                Result.success(map)
            } else {
                Result.failure(Exception("Failed to load profile"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updateProfile(userId: String, data: Map<String, Any?>): Result<Unit> {
        return try {
            val response = ApiService.put("users/$userId", data)
            if (response.isSuccess) Result.success(Unit)
            else Result.failure(Exception("Failed to update profile"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updateEmail(userId: String, email: String, password: String): Result<Unit> {
        return try {
            val hashedPassword = SHA256.hash(password)
            val response = ApiService.put("users/email", mapOf(
                "email" to email,
                "password" to hashedPassword,
                "userId" to userId
            ))
            if (response.isSuccess) Result.success(Unit)
            else Result.failure(Exception("Failed to update email"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updateAccountSettings(userId: String, settings: Map<String, Any?>): Result<Unit> {
        return try {
            val response = ApiService.put("users/$userId", settings)
            if (response.isSuccess) Result.success(Unit)
            else Result.failure(Exception("Failed to update settings"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun resetUserData(userId: String): Result<Unit> {
        return try {
            val response = ApiService.post("users/reset-data", emptyMap())
            if (response.isSuccess) Result.success(Unit)
            else Result.failure(Exception("Failed to reset data"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteAccount(userId: String, password: String, reason: String?): Result<Unit> {
        return try {
            val hashedPassword = SHA256.hash(password)
            val payload = mutableMapOf<String, Any?>(
                "password" to hashedPassword
            )
            reason?.let { payload["reason"] = it }

            val response = ApiService.post("users/delete", payload)
            if (response.isSuccess) {
                ApiService.clearToken()
                Result.success(Unit)
            } else {
                Result.failure(Exception("Failed to delete account"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deactivateAccount(userId: String, password: String, reason: String?): Result<Unit> {
        return try {
            val hashedPassword = SHA256.hash(password)
            val payload = mutableMapOf<String, Any?>(
                "password" to hashedPassword
            )
            reason?.let { payload["reason"] = it }

            val response = ApiService.post("users/deactivate", payload)
            if (response.isSuccess) {
                ApiService.clearToken()
                Result.success(Unit)
            } else {
                Result.failure(Exception("Failed to deactivate account"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
