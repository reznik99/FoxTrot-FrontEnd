package com.francescogorini.foxtrot

import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

class FlagSecureModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "FlagSecure"

    @ReactMethod
    fun enable() {
        UiThreadUtil.runOnUiThread {
            reactApplicationContext.currentActivity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    @ReactMethod
    fun disable() {
        UiThreadUtil.runOnUiThread {
            reactApplicationContext.currentActivity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}
