package com.genieai.mobile

import android.app.Application

class GenieAIApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: GenieAIApplication
            private set
    }
}
