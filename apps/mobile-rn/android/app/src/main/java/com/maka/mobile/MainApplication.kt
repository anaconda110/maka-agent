package com.maka.mobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactHost
import com.facebook.soloader.SoLoader

class MainApplication : Application() {

    private val reactNativeHost: ReactNativeHost =
        object : ReactNativeHost(this) {
            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

            override fun getPackages(): List<ReactPackage> =
                PackageList(this).packages

            override fun getJSMainModuleName(): String = "index"
        }

    override fun getReactHost(): ReactHost =
        getDefaultReactHost(applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()
        SoLoader.init(this, /* native exopackage */ false)
    }

    companion object {
        init {
            // Enable the New Architecture (Fabric/TurboModules) at runtime.
            // Only load when the new architecture was enabled at build time —
            // calling DefaultNewArchitectureEntryPoint.load() with
            // newArchEnabled=false raises "Unable to load script. Make sure
            // you're running Metro" or crashes because no native codegen code
            // was compiled. Mirrors the RN 0.79 official template gate.
            if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
                DefaultNewArchitectureEntryPoint.load()
            }
        }
    }
}