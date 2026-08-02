# Maka Android 构建指南

> 分支：`feature/android-rn`
> 模块：Phase B-Android 模块3 — Android 构建配置
> 范围：`apps/mobile-rn/android/`、`apps/mobile-rn/package.json`、`.hive/android-build-guide.md`

本指南说明如何为 Maka Android（React Native）构建 debug / release APK 与 AAB，并完成签名配置。

---

## 1. 前置环境

| 工具 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | 20+（推荐 22 LTS） | 运行 Metro、RN CLI |
| JDK | 17（Temurin 17 / OpenJDK 17） | Gradle 8 与 AGP 8.7 要求 JDK 17；JDK 21+ 需要额外 `JAVA_HOME` 配置 |
| Android SDK | compileSdk 35、build-tools 35.0.0、NDK 27.1.12297006 | 通过 Android Studio 的 SDK Manager 安装 |
| Android 最低 API | minSdkVersion 24（Android 7.0） | 运行设备最低版本 |
| targetSdkVersion | 34（Android 14） | 上架 Google Play 要求 |
| Gradle | 8.x（由 Gradle Wrapper 提供） | 首次构建会自动下载 |
| Android 设备/模拟器 | API 24+ | 用于 `run-android` |

### 1.1 环境变量

```bash
export ANDROID_HOME=$HOME/Android/Sdk            # macOS: ~/Library/Android/sdk；Windows: %LOCALAPPDATA%\Android\Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools   # adb
export JAVA_HOME=<path-to-jdk17>                  # Gradle 需要 JDK 17
```

### 1.2 首次安装依赖

在仓库根目录：

```bash
npm install            # 安装 monorepo workspace 依赖（含 apps/mobile-rn）
```

或在 `apps/mobile-rn` 内单独安装：

```bash
cd apps/mobile-rn
npm install
```

---

## 2. 关键配置文件

| 文件 | 作用 |
|------|------|
| `apps/mobile-rn/android/build.gradle` | 根 Gradle 脚本，声明 AGP 8.7.2、Kotlin、SDK 版本、react-native-gradle-plugin |
| `apps/mobile-rn/android/settings.gradle` | 工程名 `MakaMobile`，触发 RN CLI 原生模块 autolinking |
| `apps/mobile-rn/android/gradle.properties` | JVM 参数、AndroidX、Hermes、新架构开关 |
| `apps/mobile-rn/android/app/build.gradle` | `:app` 模块：applicationId、versionCode/versionName、签名配置、buildTypes |
| `apps/mobile-rn/android/app/src/main/AndroidManifest.xml` | 权限声明与 Activity 注册 |
| `apps/mobile-rn/android/app/proguard-rules.pro` | R8/ProGuard 保留规则（release 开启 minify） |
| `apps/mobile-rn/android/app/src/main/java/com/maka/mobile/` | `MainActivity.kt`、`MainApplication.kt` |

### 2.1 applicationId / 版本

在 `apps/mobile-rn/android/app/build.gradle` 的 `defaultConfig`：

```gradle
applicationId "ai.maka.mobile"
versionCode 1
versionName "0.1.0"
minSdkVersion rootProject.ext.minSdkVersion        // 24
targetSdkVersion rootProject.ext.targetSdkVersion  // 34
```

升级版本时：`versionCode` 每次发布必须递增（整数），`versionName` 是用户可见的语义化版本。

---

## 3. 权限声明

`AndroidManifest.xml` 声明的权限：

| 权限 | 用途 | 运行时申请 |
|------|------|-----------|
| `INTERNET` | 连接 runtime-host / 云端模型 | 否（普通权限） |
| `ACCESS_NETWORK_STATE` | 检测网络可用性 | 否 |
| `RECORD_AUDIO` | 语音输入（Maka 语音对话） | **是** |
| `READ_EXTERNAL_STORAGE`（≤32） | 读取附件 | **是**（≤32） |
| `WRITE_EXTERNAL_STORAGE`（≤29） | 写入导出文件 | **是**（≤29） |
| `READ_MEDIA_IMAGES/AUDIO/VIDEO`（33+） | 分媒体读取 | **是** |
| `POST_NOTIFICATIONS`（33+） | 消息/任务通知 | **是** |
| `FOREGROUND_SERVICE` | 长会话前台服务（预留） | 否 |

运行时权限通过 `react-native-permissions`（建议 module4 引入）在应用内申请。

---

## 4. 签名配置

### 4.1 Debug 签名（开箱即用）

`app/build.gradle` 的 `signingConfigs.debug` 使用 Android SDK 自带的 `~/.android/debug.keystore`（首次构建会自动生成）：

```
storePassword: android
keyAlias:      androiddebugkey
keyPassword:   android
```

无需手动配置即可 `run-android` debug 变体。

### 4.2 Release 签名（占位 → 生产）

当前 `signingConfigs.release` 为**占位配置**：未提供 `MAKA_ANDROID_*` 属性时回退到 debug keystore，仅供本地验证，**不能用于生产发布**。

生产发布前必须生成正式 keystore 并通过以下任一方式注入：

**方式 A：`~/.gradle/gradle.properties`（推荐本地开发）**

```properties
MAKA_ANDROID_STORE_FILE=/absolute/path/to/maka-release.keystore
MAKA_ANDROID_STORE_PASSWORD=********
MAKA_ANDROID_KEY_ALIAS=maka-release
MAKA_ANDROID_KEY_PASSWORD=********
```

**方式 B：CI 环境变量**（在 `android/gradle.properties` 中读取或通过 `-P` 传入）

```bash
./gradlew assembleRelease \
  -PMAKA_ANDROID_STORE_FILE=$MAKA_ANDROID_STORE_FILE \
  -PMAKA_ANDROID_STORE_PASSWORD=$MAKA_ANDROID_STORE_PASSWORD \
  -PMAKA_ANDROID_KEY_ALIAS=$MAKA_ANDROID_KEY_ALIAS \
  -PMAKA_ANDROID_KEY_PASSWORD=$MAKA_ANDROID_KEY_PASSWORD
```

**生成 release keystore：**

```bash
keytool -genkeypair -v \
  -keystore maka-release.keystore \
  -alias maka-release \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass <storepass> -keypass <keypass>
```

> 安全提示：keystore 文件、密码不得提交到仓库。CI 通过密钥管理服务注入。

---

## 5. 构建命令

所有命令均在 `apps/mobile-rn` 目录下执行（`package.json` 已配置 scripts）。

### 5.1 启动 Metro（开发时）

```bash
npm run start
# 或
npx react-native start
```

### 5.2 Debug 构建（连设备/模拟器运行）

```bash
npm run android
# 等价于
npx react-native run-android
```

该命令会：安装 debug APK + 启动 app + 连接 Metro。debug 变体使用 debug keystore、`applicationIdSuffix=.debug`、`versionNameSuffix=-debug`。

### 5.3 Release APK（本地验证）

```bash
npm run build:android:release
# 等价于
cd android && ./gradlew assembleRelease
```

产物路径：`apps/mobile-rn/android/app/build/outputs/apk/release/app-release.apk`

> 未配置 release keystore 时，会回退到 debug 签名（占位），仅用于本地冒烟。

### 5.4 Release AAB（上架 Google Play）

```bash
npm run bundle:android:release
# 等价于
cd android && ./gradlew bundleRelease
```

产物路径：`apps/mobile-rn/android/app/build/outputs/bundle/release/app-release.aab`

### 5.5 清理

```bash
npm run clean:android
# 或
cd android && ./gradlew clean
```

清完重构建：`npm run clean:android && npm run build:android:release`

### 5.6 一次性脚本对照表

| npm script | 命令 | 产物 |
|-----------|------|------|
| `npm run android` | `react-native run-android` | 安装并启动 debug APK |
| `npm run android:release` | `react-native run-android --variant=release` | 安装并启动 release APK |
| `npm run build:android:debug` | `cd android && ./gradlew assembleDebug` | `app-debug.apk` |
| `npm run build:android:release` | `cd android && ./gradlew assembleRelease` | `app-release.apk` |
| `npm run bundle:android:release` | `cd android && ./gradlew bundleRelease` | `app-release.aab` |
| `npm run clean:android` | `cd android && ./gradlew clean` | （清理） |

---

## 6. 直接使用 Gradle Wrapper（可选）

当前脚手架未生成 `gradlew`。首次完整构建建议通过 React Native CLI 触发，或在 Android Studio 中打开 `apps/mobile-rn/android` 自动同步生成 Wrapper。如需手动生成：

```bash
cd apps/mobile-rn/android
gradle wrapper --gradle-version 8.10.2   # 需本机安装 gradle；或用 Android Studio
```

生成后 `./gradlew` 即可替代 `gradle`。

---

## 7. R8 / ProGuard

- `app/build.gradle` 的 release buildType 已开启 `minifyEnabled true` + `shrinkResources true`。
- 规则文件：`app/proguard-rules.pro`（Maka 自定义）+ AGP 默认 `proguard-android-optimize.txt`。
- 主要保留：React Native bridge、Hermes、`com.maka.mobile.*`、keychain、sqlite、okhttp/okio。
- 若 release 构建出现 `ClassNotFoundException`，先在该文件中 `-keep` 对应类，再排查。

---

## 8. 冒烟测试清单（release APK）

1. `npm run build:android:release` 成功，产出 `app-release.apk`。
2. `adb install -r app-release.apk` 安装无报错。
3. 启动 Maka，首屏（HomeScreen）正常显示。
4. 切换到 Settings/Chat Tab 正常。
5. （联网）发起一次消息，确认 runtime-host 连接（云端优先）能建立。
6. （权限）首次进入语音/附件功能时弹出 RECORD_AUDIO / READ_MEDIA_* 权限请求。
7. 退出再启动，状态持久化正常（AsyncStorage / SQLite）。

---

## 9. 已知限制与后续

- Gradle Wrapper 尚未生成；首次构建需通过 RN CLI 或 Android Studio 同步生成 `gradlew`。
- release keystore 为占位，CI 发布前必须注入 `MAKA_ANDROID_*` 签名属性。
- 未配置 ABI splits / bundle（按需后续优化包体积）。
- `react-native-permissions` 运行时权限封装由后续模块负责。
- 与模块1（脚手架 UI）+ 模块2（服务层）共享 `apps/mobile-rn/package.json`，已合并各自的依赖与 scripts。

---

## 10. 变更文件清单

- `apps/mobile-rn/android/settings.gradle`（新增）
- `apps/mobile-rn/android/build.gradle`（新增）
- `apps/mobile-rn/android/gradle.properties`（新增）
- `apps/mobile-rn/android/app/build.gradle`（新增）
- `apps/mobile-rn/android/app/src/main/AndroidManifest.xml`（新增）
- `apps/mobile-rn/android/app/src/main/java/com/maka/mobile/MainActivity.kt`（新增）
- `apps/mobile-rn/android/app/src/main/java/com/maka/mobile/MainApplication.kt`（新增）
- `apps/mobile-rn/android/app/src/main/res/values/strings.xml`（新增）
- `apps/mobile-rn/android/app/src/main/res/values/styles.xml`（新增）
- `apps/mobile-rn/android/app/proguard-rules.pro`（新增）
- `apps/mobile-rn/package.json`（修改：增加 build scripts、合并 RN 依赖）
- `.hive/android-build-guide.md`（本文档）