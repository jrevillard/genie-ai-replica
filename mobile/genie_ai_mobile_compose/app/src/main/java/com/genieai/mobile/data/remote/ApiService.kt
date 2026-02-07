package com.genieai.mobile.data.remote

import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.util.concurrent.TimeUnit

object ApiService {

    private const val TAG = "ApiService"
    const val BASE_URL = "https://genie-ai.itu.int/api"

    private var accessToken: String? = null
    val gson = Gson()

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    fun setToken(token: String) {
        Log.d(TAG, "Setting access token: ${token.take(5)}...")
        accessToken = token
    }

    fun clearToken() {
        Log.d(TAG, "Clearing access token")
        accessToken = null
    }

    fun getToken(): String? = accessToken

    private fun buildRequest(url: String): Request.Builder {
        val builder = Request.Builder().url(url)
        accessToken?.let { builder.addHeader("Authorization", "Bearer $it") }
        builder.addHeader("Content-Type", "application/json")
        return builder
    }

    suspend fun get(endpoint: String, params: Map<String, String>? = null): ApiResponse {
        return withContext(Dispatchers.IO) {
            val urlBuilder = StringBuilder("$BASE_URL/$endpoint")
            params?.let { p ->
                if (p.isNotEmpty()) {
                    urlBuilder.append("?")
                    urlBuilder.append(p.entries.joinToString("&") { "${it.key}=${it.value}" })
                }
            }
            val url = urlBuilder.toString()
            Log.d(TAG, "GET $url")

            try {
                val request = buildRequest(url).get().build()
                val response = client.newCall(request).execute()
                parseResponse(response)
            } catch (e: Exception) {
                Log.e(TAG, "GET error: ${e.message}", e)
                ApiResponse(statusCode = -1, body = null, error = e.message)
            }
        }
    }

    suspend fun post(endpoint: String, data: Map<String, Any?>): ApiResponse {
        return withContext(Dispatchers.IO) {
            val url = "$BASE_URL/$endpoint"
            val json = gson.toJson(data)
            Log.d(TAG, "POST $url — Body: $json")

            try {
                val body = json.toRequestBody("application/json".toMediaType())
                val request = buildRequest(url).post(body).build()
                val response = client.newCall(request).execute()
                parseResponse(response)
            } catch (e: Exception) {
                Log.e(TAG, "POST error: ${e.message}", e)
                ApiResponse(statusCode = -1, body = null, error = e.message)
            }
        }
    }

    suspend fun put(endpoint: String, data: Map<String, Any?>): ApiResponse {
        return withContext(Dispatchers.IO) {
            val url = "$BASE_URL/$endpoint"
            val json = gson.toJson(data)
            Log.d(TAG, "PUT $url — Body: $json")

            try {
                val body = json.toRequestBody("application/json".toMediaType())
                val request = buildRequest(url).put(body).build()
                val response = client.newCall(request).execute()
                parseResponse(response)
            } catch (e: Exception) {
                Log.e(TAG, "PUT error: ${e.message}", e)
                ApiResponse(statusCode = -1, body = null, error = e.message)
            }
        }
    }

    suspend fun patch(endpoint: String, data: Map<String, Any?>): ApiResponse {
        return withContext(Dispatchers.IO) {
            val url = "$BASE_URL/$endpoint"
            val json = gson.toJson(data)
            Log.d(TAG, "PATCH $url — Body: $json")

            try {
                val body = json.toRequestBody("application/json".toMediaType())
                val request = buildRequest(url).patch(body).build()
                val response = client.newCall(request).execute()
                parseResponse(response)
            } catch (e: Exception) {
                Log.e(TAG, "PATCH error: ${e.message}", e)
                ApiResponse(statusCode = -1, body = null, error = e.message)
            }
        }
    }

    suspend fun delete(endpoint: String, params: Map<String, String>? = null): ApiResponse {
        return withContext(Dispatchers.IO) {
            val urlBuilder = StringBuilder("$BASE_URL/$endpoint")
            params?.let { p ->
                if (p.isNotEmpty()) {
                    urlBuilder.append("?")
                    urlBuilder.append(p.entries.joinToString("&") { "${it.key}=${it.value}" })
                }
            }
            val url = urlBuilder.toString()
            Log.d(TAG, "DELETE $url")

            try {
                val request = buildRequest(url).delete().build()
                val response = client.newCall(request).execute()
                parseResponse(response)
            } catch (e: Exception) {
                Log.e(TAG, "DELETE error: ${e.message}", e)
                ApiResponse(statusCode = -1, body = null, error = e.message)
            }
        }
    }

    private fun parseResponse(response: Response): ApiResponse {
        val bodyString = response.body?.string()
        Log.d(TAG, "Response ${response.code}: $bodyString")
        val jsonBody = try {
            bodyString?.let { gson.fromJson(it, JsonObject::class.java) }
        } catch (_: Exception) {
            null
        }
        return ApiResponse(
            statusCode = response.code,
            body = jsonBody,
            rawBody = bodyString
        )
    }
}

data class ApiResponse(
    val statusCode: Int,
    val body: JsonObject? = null,
    val rawBody: String? = null,
    val error: String? = null
) {
    val isSuccess: Boolean get() = statusCode in 200..299
}
