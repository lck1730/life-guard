// ⚠️ 要显式 import：Kotlin DSL 里 `java` 被 Gradle 的 java 扩展占着 ✗，
// 写 `java.util.Properties()` 会报 Unresolved reference ✗。
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.lifeguard.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.lifeguard.app"
        minSdk = 26
        targetSdk = 35
        // 应用内更新靠这两个数字比大小（服务端 releases/latest.json 里也有一份）。
        // **每发一版都要往上加**，否则手机端会认为"没有新版"。
        versionCode = 17
        versionName = "0.7.0"
    }

    // ★ 固定签名（2026-10-06 起）。
    //
    // 以前复用 `~/.android/debug.keystore` —— 那个文件**每台电脑都不一样** ✗。
    // 换台机器打包，签名就变了 ✗，而 Android **不允许签名不同的包覆盖安装** ✗：
    // 只能卸载重装，数据全没 ✗。自己一个人装时无所谓 ✓，但装上第二台手机
    // （女朋友那台）之后，这就是一颗定时炸弹 ✗。
    //
    // 密码从 `keystore/keystore.properties` 读（和 .jks 放一起 ✓）。
    // ⚠️ **那两个文件要一起备份** —— 丢了就永远发不出能覆盖升级的包了 ✗。
    signingConfigs {
        create("release") {
            val props = Properties()
            val f = rootProject.file("keystore/keystore.properties")
            if (f.exists()) {
                f.inputStream().use { props.load(it) }
                storeFile = rootProject.file(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // 没配就退回 debug 签名（本机调试用 ✓）；配了就一律用固定那把 ✓
            signingConfig = if (rootProject.file("keystore/keystore.properties").exists())
                signingConfigs.getByName("release")
            else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

/**
 * 依赖很少是**刻意**的。
 *
 * 界面已经全部搬到服务器上的 HTML/JS 里，这个 APK 只是个 WebView 外壳。
 * 所以不引 Compose、不引 Retrofit/OkHttp——它们只会让包白白变大，
 * 而"改界面不用重装"这件事，靠的是服务器换文件，不是靠本地框架。
 */
dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    // OnBackPressedDispatcher 在这里——返回手势/返回键的统一入口。
    // 只监听 onKeyDown 在全面屏手势导航下不可靠，必须走这个。
    implementation("androidx.activity:activity-ktx:1.9.3")
}
