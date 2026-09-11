package com.rmhedge.displays

import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.androidbrowserhelper.trusted.TwaLauncher

class TwaLauncherModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    private var launcher: TwaLauncher? = null

    override fun getName(): String = "TwaLauncher"

    @ReactMethod
    fun launch(url: String, promise: Promise) {
        val activity = currentActivity

        if (activity == null) {
            promise.reject(
                "NO_ACTIVITY",
                "No foreground Android activity is available",
            )
            return
        }

        try {
            launcher = TwaLauncher(activity)

            launcher!!.launch(Uri.parse(url))

            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject(
                "TWA_LAUNCH_FAILED",
                error,
            )
        }
    }

    override fun invalidate() {
        launcher = null
        super.invalidate()
    }
}
