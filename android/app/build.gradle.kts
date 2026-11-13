import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 版は Web 版(WebCalendar の package.json)と同じにする。1.12.3 → versionCode 11203(更新するたびに大きくなる)
val webVersion: String = (groovy.json.JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>)["version"] as String
val webVersionCode: Int = webVersion.split(".").map { it.toInt() }.let { (a, b, c) -> a * 10000 + b * 100 + c }

// 署名の鍵(build_apk.ps1 が初回に keystore\ に作る。パスワードは keystore\keystore.properties)
val keyProps = Properties().apply {
    val f = rootProject.file("keystore/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "io.github.kkvesper01592.calendar"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.kkvesper01592.calendar"
        minSdk = 26
        targetSdk = 36
        versionCode = webVersionCode
        versionName = webVersion
    }

    signingConfigs {
        create("release") {
            if (keyProps.isNotEmpty()) {
                storeFile = rootProject.file("keystore/" + keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            // 動作確認用。正式版と同時に入れられるよう別のアプリとして扱う
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    // Google ログイン(Google Play 開発者サービスの AuthorizationClient)
    implementation("com.google.android.gms:play-services-auth:21.4.0")
}
