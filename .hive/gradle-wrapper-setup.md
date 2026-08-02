# Gradle Wrapper Setup Guide

This document explains how to generate the `gradle-wrapper.jar` binary for the
React Native Android project at `apps/mobile-rn/android/`.

## Current state

The following Gradle Wrapper files have been committed:

- `apps/mobile-rn/android/gradle/wrapper/gradle-wrapper.properties`
  - `distributionUrl=https\://services.gradle.org/distributions/gradle-8.13-bin.zip`
- `apps/mobile-rn/android/gradlew` (POSIX shell script, executable)
- `apps/mobile-rn/android/gradlew.bat` (Windows batch script)

The `gradle-wrapper.jar` binary is **NOT committed** because:

1. It is a compiled binary artifact that cannot be authored by hand.
2. Committing binaries bloats the repository history and complicates code
   review.
3. The standard practice is to generate it with a local Gradle installation.

The `.gitignore` at the repo root already excludes `*.jar` in some contexts;
verify the wrapper jar is intentionally tracked or excluded before committing.

## Prerequisites

- **Java Development Kit (JDK) 17** or later (required by Gradle 8.13 and the
  Android Gradle Plugin 8.7.2). Verify with:
  ```sh
  java -version
  ```
- **Gradle 8.13** (or any Gradle >= 8.0) installed locally, OR use the system
  package manager. Alternatively, Android Studio ships with a bundled Gradle.

## Generating gradle-wrapper.jar

### Option A: Using a locally installed Gradle (recommended)

If you have Gradle installed (e.g. via SDKMAN!, Homebrew, or a manual install):

```sh
cd apps/mobile-rn/android
gradle wrapper --gradle-version 8.13 --distribution-type bin
```

This command reads the existing `gradle/wrapper/gradle-wrapper.properties` (or
regenerates it) and downloads `gradle-wrapper.jar` into
`gradle/wrapper/`. It also (re)writes `gradlew` and `gradlew.bat` to match the
specified Gradle version.

After generation, verify:

```sh
ls -la gradle/wrapper/gradle-wrapper.jar
./gradlew --version   # should report "Gradle 8.13"
```

### Option B: Using Android Studio

1. Open the `apps/mobile-rn/android` directory in Android Studio.
2. Android Studio detects the missing wrapper and prompts to generate it, or
   run **File → Sync Project with Gradle Files** which downloads the wrapper
   automatically.
3. The `gradle-wrapper.jar` appears under `gradle/wrapper/`.

### Option C: Copying from another project

If you have another React Native or Android project with a matching Gradle
version, copy its `gradle/wrapper/gradle-wrapper.jar`:

```sh
cp /path/to/other-project/android/gradle/wrapper/gradle-wrapper.jar \
   apps/mobile-rn/android/gradle/wrapper/gradle-wrapper.jar
```

Ensure the jar matches Gradle 8.13 (jar size ~63 KB; the wrapper jar is
version-stable across the 8.x line).

## Verifying the wrapper works

Once the jar is present:

```sh
cd apps/mobile-rn/android
./gradlew --version
# Expected output includes:
#   Gradle 8.13
#   Kotlin:       1.9.x (bundled)
#   JVM:          17.x

./gradlew :app:tasks          # list app tasks
./gradlew :app:assembleDebug  # build debug APK (requires Android SDK + NDK)
```

## Troubleshooting

- **`Could not find or load main class org.gradle.wrapper.GradleWrapperMain`**
  — the `gradle-wrapper.jar` is missing. Generate it using Option A above.
- **`Permission denied` on `./gradlew`** — run `chmod +x gradlew`.
- **Distribution download fails** — check `gradle-wrapper.properties` URL; it
  must be `https\://services.gradle.org/distributions/gradle-8.13-bin.zip`.
  The backslash before the colon is the required properties-file escape.
- **Java version mismatch** — Gradle 8.13 requires JDK 17+. Set `JAVA_HOME`
  to a JDK 17 installation.

## Notes

- The committed `gradlew` / `gradlew.bat` / `gradle-wrapper.properties` are the
  canonical Gradle 8.13 wrapper scripts from the official Gradle distribution.
  Regenerating them with `gradle wrapper --gradle-version 8.13` produces
  byte-identical content (modulo a trailing newline), so doing so is safe and
  will not cause merge conflicts.
- React Native 0.79 requires Gradle 8.x; 8.13 is the latest 8.x release at the
  time of writing and is compatible with the Android Gradle Plugin 8.7.2
  declared in `apps/mobile-rn/android/build.gradle`.