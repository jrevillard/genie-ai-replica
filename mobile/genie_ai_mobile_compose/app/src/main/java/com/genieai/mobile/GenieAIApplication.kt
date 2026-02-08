package com.genieai.mobile

import android.app.Application
import com.genieai.mobile.service.ConfigService

class GenieAIApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
        ConfigService.init(this)
    }

    companion object {
        lateinit var instance: GenieAIApplication
            private set
    }
}
