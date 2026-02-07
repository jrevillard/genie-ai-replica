package com.genieai.mobile.data.repository

import com.genieai.mobile.service.ConnectivityService
import kotlinx.coroutines.flow.StateFlow

object ConnectivityRepository {
    val isOnline: StateFlow<Boolean> = ConnectivityService.isOnline

    fun isEffectivelyOnline(): Boolean = ConnectivityService.effectiveOnline

    fun toggleUserOfflineMode() = ConnectivityService.toggleUserOfflineMode()

    fun isUserOffline(): Boolean = ConnectivityService.isUserOffline()

    suspend fun recheckNow() = ConnectivityService.recheckNow()
}
