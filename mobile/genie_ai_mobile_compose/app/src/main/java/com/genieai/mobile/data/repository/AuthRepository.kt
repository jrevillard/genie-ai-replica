package com.genieai.mobile.data.repository

import com.genieai.mobile.data.model.User
import com.genieai.mobile.data.remote.ApiService
import com.genieai.mobile.util.SHA256

object AuthRepository {

    suspend fun login(loginName: String, password: String): Result<User> {
        return try {
            val hashedPassword = SHA256.hash(password)
            val response = ApiService.post("auth/login", mapOf(
                "loginName" to loginName,
                "encPassword" to hashedPassword
            ))

            if (response.isSuccess && response.body != null) {
                val body = response.body
                val token = body.get("accessToken")?.asString
                    ?: return Result.failure(Exception("No access token"))
                ApiService.setToken(token)

                val userObj = body.getAsJsonObject("user")
                val user = User(
                    id = userObj?.get("_key")?.asString
                        ?: userObj?.get("id")?.asString ?: "",
                    loginName = userObj?.get("loginName")?.asString ?: loginName,
                    email = userObj?.get("email")?.asString ?: "",
                    firstName = userObj?.get("firstName")?.asString,
                    lastName = userObj?.get("lastName")?.asString,
                    role = userObj?.get("role")?.asString
                )
                Result.success(user)
            } else {
                Result.failure(Exception("Login failed (${response.statusCode})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun logout(): Result<Unit> {
        return try {
            ApiService.post("auth/logout", emptyMap())
            ApiService.clearToken()
            Result.success(Unit)
        } catch (e: Exception) {
            ApiService.clearToken()
            Result.failure(e)
        }
    }

    suspend fun fetchCurrentUser(): Result<User> {
        return try {
            val response = ApiService.get("auth/me")
            if (response.isSuccess && response.body != null) {
                val body = response.body
                // Backend wraps user in a "user" key
                val userObj = body.getAsJsonObject("user") ?: body
                val user = User(
                    id = userObj.get("_key")?.asString
                        ?: userObj.get("id")?.asString ?: "",
                    loginName = userObj.get("loginName")?.asString ?: "",
                    email = userObj.get("email")?.asString ?: "",
                    firstName = userObj.get("firstName")?.asString,
                    lastName = userObj.get("lastName")?.asString,
                    role = userObj.get("role")?.asString
                )
                if (user.id.isBlank()) {
                    Result.failure(Exception("User ID missing from auth/me response"))
                } else {
                    Result.success(user)
                }
            } else {
                Result.failure(Exception("Failed to fetch user"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun register(
        loginName: String,
        email: String,
        password: String
    ): Result<Unit> {
        return try {
            val hashedPassword = SHA256.hash(password)
            val response = ApiService.post("auth/register", mapOf(
                "loginName" to loginName,
                "email" to email,
                "encPassword" to hashedPassword
            ))

            if (response.isSuccess) {
                Result.success(Unit)
            } else {
                val msg = response.body?.get("message")?.asString ?: "Registration failed"
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun initiatePasswordReset(email: String): Result<Unit> {
        return try {
            val response = ApiService.post("auth/password-reset", mapOf("email" to email))
            if (response.isSuccess) {
                Result.success(Unit)
            } else {
                Result.failure(Exception("Password reset failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun confirmPasswordReset(token: String, newPassword: String): Result<Unit> {
        return try {
            val hashedPassword = SHA256.hash(newPassword)
            val response = ApiService.post("auth/reset-password/confirm", mapOf(
                "token" to token,
                "newPassword" to hashedPassword
            ))
            if (response.isSuccess) {
                Result.success(Unit)
            } else {
                Result.failure(Exception("Password reset confirmation failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun checkUsernameAvailability(username: String): Result<Boolean> {
        return try {
            val response = ApiService.get("users/check-username", mapOf("username" to username))
            if (response.isSuccess) {
                val available = response.body?.get("available")?.asBoolean ?: false
                Result.success(available)
            } else {
                Result.failure(Exception("Check failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun checkEmailAvailability(email: String): Result<Boolean> {
        return try {
            val response = ApiService.get("users/check-email", mapOf("email" to email))
            if (response.isSuccess) {
                val available = response.body?.get("available")?.asBoolean ?: false
                Result.success(available)
            } else {
                Result.failure(Exception("Check failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
