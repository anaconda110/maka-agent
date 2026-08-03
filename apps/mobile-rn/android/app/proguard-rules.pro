# ProGuard / R8 rules for Maka Android (React Native 0.79, Hermes enabled)
#
# The React Native Gradle plugin already injects the bundled
# `react-native/proguard-rules.pro` for RN internals; the rules below extend
# those defaults for Maka-specific and third-party dependencies.

# --- Keep the app entry points ---
# The React Native Gradle plugin injects `react-native/proguard-rules.pro`,
# which already keeps the RN bridge, TurboModules, Hermes internals, and
# annotated modules. Avoid a blanket `-keep class com.facebook.react.**` so
# R8 can prune dead RN internals; only keep app-specific classes here.
-keep class com.maka.mobile.** { *; }
-keep class com.maka.mobile.MainApplication { *; }
-keep class com.maka.mobile.MainActivity { *; }

# --- Hermes JS engine ---
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.hermes.instrument.** { *; }

# --- react-native-keychain (security / crypto) ---
-keep class com.oblador.keychain.** { *; }
-keep class javax.crypto.** { *; }

# --- react-native-sqlite-storage ---
-keep class org.pgsqlite.** { *; }
-keep class io.sqlc.** { *; }

# --- react-native-async-storage ---
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# --- Keep all annotated React Native modules / TurboModules ---
-keep @com.facebook.react.module.annotations.** class * { *; }
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod <methods>;
}

# --- okhttp / networking (transitive via RN) ---
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# --- Kotlin metadata ---
-keep class kotlin.Metadata { *; }
-keepclassmembers class ** {
    @kotlin.Metadata *;
}

# --- Strip verbose logging in release ---
-assumenosideeffects class android.util.Log {
    public *;
}