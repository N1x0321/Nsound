plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// La versión la pone build-android.yml (-PnsoundVersionCode / -PnsoundVersionName). En local salen valores de desarrollo,
// con los que la app no avisa de versiones nuevas.
val nsoundVersionCode = (findProperty("nsoundVersionCode") as String?)?.toInt() ?: 2
val nsoundVersionName = (findProperty("nsoundVersionName") as String?) ?: "0.0.0-dev"

// Firma fija: la clave llega por variables de entorno (secretos de GitHub). Sin ella se firma con la clave de depuración.
fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotEmpty() }
val keystorePath = env("ANDROID_KEYSTORE_FILE")

android {
    namespace = "org.librestream.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "org.librestream.app"
        minSdk = 24
        targetSdk = 34
        versionCode = nsoundVersionCode
        versionName = nsoundVersionName
    }

    signingConfigs {
        if (keystorePath != null) {
            create("nsound") {
                storeFile = file(keystorePath)
                storeType = "pkcs12"
                storePassword = env("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = env("ANDROID_KEY_ALIAS")
                keyPassword = env("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("nsound") ?: signingConfigs.getByName("debug")
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

    // La interfaz compartida (index.html + eq.js) se genera con `node app/build.mjs` y se empaqueta como assets
    sourceSets["main"].assets.srcDir("../../app/dist")
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
}
