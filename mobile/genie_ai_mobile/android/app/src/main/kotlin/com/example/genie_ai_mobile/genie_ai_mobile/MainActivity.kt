package com.example.genie_ai_mobile.genie_ai_mobile

import android.os.Bundle
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Android 12+ SplashScreen API: install the splash BEFORE
        // super.onCreate so the manifest's launch_background drawable
        // (the AgroGenio farmer on the brand verde) is the one the
        // system shows during cold start, instead of falling back to
        // the launcher icon.
        installSplashScreen()
        super.onCreate(savedInstanceState)
    }
}
