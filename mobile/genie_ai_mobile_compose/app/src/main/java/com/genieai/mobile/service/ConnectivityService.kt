package com.genieai.mobile.service

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import com.genieai.mobile.GenieAIApplication
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.InetSocketAddress
import java.net.Socket

object ConnectivityService {

    private const val TAG = "ConnectivityService"
    private const val POLL_INTERVAL_MS = 5000L

    private val _isOnline = MutableStateFlow(true)
    val isOnline: StateFlow<Boolean> = _isOnline.asStateFlow()

    private var userOfflineMode = false
    private var isInitialized = false
    private var pollingJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    val effectiveOnline: Boolean
        get() = _isOnline.value && !userOfflineMode

    fun init(context: Context = GenieAIApplication.instance) {
        if (isInitialized) return
        isInitialized = true

        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        // Check initial state
        val activeNetwork = connectivityManager.activeNetwork
        val capabilities = activeNetwork?.let { connectivityManager.getNetworkCapabilities(it) }
        _isOnline.value = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

        // Register callback for real-time updates
        val networkRequest = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        connectivityManager.registerNetworkCallback(networkRequest, object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.d(TAG, "Network available")
                _isOnline.value = true
            }

            override fun onLost(network: Network) {
                Log.d(TAG, "Network lost")
                _isOnline.value = false
            }

            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                val hasInternet = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                _isOnline.value = hasInternet
            }
        })

        // Start polling watchdog
        startPolling()
    }

    private fun startPolling() {
        pollingJob?.cancel()
        pollingJob = scope.launch {
            while (isActive) {
                delay(POLL_INTERVAL_MS)
                checkConnectivity()
            }
        }
    }

    private suspend fun checkConnectivity() {
        withContext(Dispatchers.IO) {
            try {
                val socket = Socket()
                socket.connect(InetSocketAddress("8.8.8.8", 53), 3000)
                socket.close()
                if (!_isOnline.value) {
                    Log.d(TAG, "Polling: back online")
                    _isOnline.value = true
                }
            } catch (_: Exception) {
                if (_isOnline.value) {
                    Log.d(TAG, "Polling: went offline")
                    _isOnline.value = false
                }
            }
        }
    }

    fun toggleUserOfflineMode() {
        userOfflineMode = !userOfflineMode
        Log.d(TAG, "User offline mode: $userOfflineMode")
    }

    fun isUserOffline(): Boolean = userOfflineMode

    suspend fun recheckNow() {
        checkConnectivity()
    }
}
