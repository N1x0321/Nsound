package org.librestream.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.PowerManager
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.media.AudioManager
import android.provider.Settings
import org.json.JSONObject
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import java.io.File

/** Envoltorio nativo de la interfaz compartida (app/dist/index.html) dentro de un WebView. */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSave: String? = null

    /** Interruptor de anuncios (lo cambia la interfaz desde Ajustes). Se lee en el hilo de red del WebView. */
    @Volatile
    var adBlockEnabled: Boolean = true

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        // Android 13+: la notificación de reproducción necesita permiso (si se rechaza, la música sigue sonando)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        }

        root = FrameLayout(this).apply { setBackgroundColor(BACKGROUND) }
        web = WebView(this).apply { setBackgroundColor(BACKGROUND) }
        root.addView(web, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        setContentView(root)
        root.fitsSystemWindows = true

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true                       // localStorage: biblioteca, listas y ajustes
            mediaPlaybackRequiresUserGesture = false       // la canción empieza al pulsar la tarjeta
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        // Sirve la interfaz y las descargas bajo un origen https (el reproductor de YouTube lo exige)
        val downloads = File(filesDir, "downloads").apply { mkdirs() }
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/media/", WebViewAssetLoader.InternalStoragePathHandler(this, downloads))
            .build()

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (adBlockEnabled && AdBlock.isAd(request.url.toString())) {
                    return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
                return loader.shouldInterceptRequest(request.url)
            }

            // Ayuda de pruebas (emulador): --es route home|music|videos|library|settings  --es action play
            private var hookDone = false
            override fun onPageFinished(view: WebView, url: String?) {
                if (hookDone) return
                hookDone = true
                val route = this@MainActivity.intent.getStringExtra("route")
                if (route in setOf("home", "music", "videos", "library", "settings")) view.evaluateJavascript("location.hash='#/$route'", null)
                if (this@MainActivity.intent.getStringExtra("action") == "play") {
                    view.postDelayed({ view.evaluateJavascript("var c=document.querySelector('.card'); if(c) c.click();", null) }, 8000)
                }
            }

            // Los enlaces externos se abren en el navegador; la propia app y los iframes siguen dentro
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                // El sistema cerró el proceso de la página (suele pasar en segundo plano con poca memoria o ahorro agresivo): se vuelve a cargar
                BgLog.add("página", "el sistema cerró el proceso de la página (se cerró por fallo: ${detail.didCrash()})")
                view.post { view.reload() }
                return true
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == ASSET_HOST || !request.isForMainFrame) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) { /* sin navegador */ }
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            // Pantalla completa del vídeo de YouTube
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) { callback.onCustomViewHidden(); return }
                customView = view
                customCallback = callback
                root.addView(view, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                web.visibility = View.GONE
            }

            // Selector de archivos del sistema (importar una lista desde un CSV, JSON o TXT)
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(params.createIntent(), FILE_REQUEST)
                    true
                } catch (e: Exception) { fileCallback = null; false }
            }

            override fun onHideCustomView() {
                customView?.let { root.removeView(it) }
                customView = null
                customCallback?.onCustomViewHidden()
                customCallback = null
                web.visibility = View.VISIBLE
            }
        }

        web.addJavascriptInterface(NativeBridge(this, web), "AndroidBridge")
        BgLog.init(filesDir)
        BgLog.add("actividad", "onCreate · nueva ejecución de Nsound")
        registerReceiver(screenReceiver, IntentFilter().apply { addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_USER_PRESENT) })

        // Ecualizador: se inyecta en el iframe de YouTube antes de que cargue su contenido
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            val eq = assets.open("eq.js").bufferedReader().use { it.readText() }
            WebViewCompat.addDocumentStartJavaScript(web, eq, setOf("https://www.youtube.com", "https://www.youtube-nocookie.com"))
        }

        web.loadUrl("https://$ASSET_HOST/assets/index.html")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            customView != null -> web.webChromeClient?.onHideCustomView()
            else -> web.evaluateJavascript("(window.__lsBack && window.__lsBack()) === true") { handled ->
                // Primero se cierra lo que esté encima (Reproduciendo, cola, menús); si no había nada, se vuelve a la página anterior
                if (handled != "true") { if (web.canGoBack()) web.goBack() else finish() }
            }
        }
    }

    /** Guarda un texto (copia de la biblioteca) donde elija el usuario con el selector del sistema. */
    fun saveText(name: String, text: String) {
        runOnUiThread {
            pendingSave = text
            val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_TITLE, name)
            }
            try {
                @Suppress("DEPRECATION")
                startActivityForResult(i, SAVE_REQUEST)
            } catch (e: Exception) { pendingSave = null }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == SAVE_REQUEST) {
            val uri = data?.data
            val text = pendingSave
            pendingSave = null
            if (resultCode == RESULT_OK && uri != null && text != null) {
                try { contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) } } catch (_: Exception) { /* sin permiso o cancelado */ }
            }
            return
        }
        if (requestCode == FILE_REQUEST) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    // ---------- Segundo plano en cada fabricante (Oppo/ColorOS, Xiaomi, Samsung, Huawei, Vivo…) ----------
    // Muchos móviles cierran o congelan las apps en segundo plano aunque tengan notificación de música. Lo que se puede hacer desde la app es
    // pedir que no se la restrinja y llevar al usuario a los ajustes del fabricante; el resto lo decide el sistema del móvil.

    /** Datos del móvil y si Nsound ya está fuera del ahorro de batería. */
    fun batteryInfo(): JSONObject {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        return JSONObject()
            .put("manufacturer", Build.MANUFACTURER ?: "")
            .put("brand", Build.BRAND ?: "")
            .put("model", Build.MODEL ?: "")
            .put("sdk", Build.VERSION.SDK_INT)
            .put("release", Build.VERSION.RELEASE ?: "")
            .put("ignoring", try { pm.isIgnoringBatteryOptimizations(packageName) } catch (_: Exception) { false })
    }

    private fun tryStart(intent: Intent): Boolean = try {
        startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
    } catch (_: Exception) { false }          // no existe en este móvil o no se permite abrirla

    /** Ejecuta en el hilo principal y espera el resultado (las pantallas de ajustes se abren desde ahí). */
    private fun <T> onMain(default: T, block: () -> T): T {
        val latch = java.util.concurrent.CountDownLatch(1)
        var out: T = default
        runOnUiThread { try { out = block() } finally { latch.countDown() } }
        latch.await(3, java.util.concurrent.TimeUnit.SECONDS)
        return out
    }

    /** Pide quitar la restricción de batería; si el móvil no lo permite, abre la lista de apps con ahorro. */
    fun openBatterySettings(): String = onMain("ninguna") {
        when {
            tryStart(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) -> "peticion"
            tryStart(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) -> "lista"
            tryStart(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) -> "detalles"
            else -> "ninguna"
        }
    }

    fun openAppSettings(): String = onMain("ninguna") {
        if (tryStart(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))) "detalles" else "ninguna"
    }

    /** Pantallas de «inicio automático» / «actividad en segundo plano» de cada fabricante. Se prueban por orden; si ninguna existe, ajustes de la app. */
    fun openAutostartSettings(): String {
        val m = ((Build.MANUFACTURER ?: "") + " " + (Build.BRAND ?: "")).lowercase()
        val candidates: List<Pair<String, String>> = when {
            "xiaomi" in m || "redmi" in m || "poco" in m ->
                listOf("com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity")
            "oppo" in m || "realme" in m || "oneplus" in m ->
                listOf(
                    "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
                    "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
                    "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
                    "com.oplus.battery" to "com.oplus.powermanager.fuelgaue.PowerUsageModelActivity",
                    "com.coloros.oppoguardelf" to "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity")
            "vivo" in m || "iqoo" in m ->
                listOf(
                    "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
                    "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")
            "huawei" in m || "honor" in m ->
                listOf(
                    "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
                    "com.huawei.systemmanager" to "com.huawei.systemmanager.optimize.process.ProtectActivity")
            "samsung" in m ->
                listOf("com.samsung.android.lool" to "com.samsung.android.sm.ui.battery.BatteryActivity")
            else -> emptyList()
        }
        return onMain("ninguna") {
            if (candidates.any { (pkg, cls) -> tryStart(Intent().setComponent(ComponentName(pkg, cls))) }) "fabricante"
            else if (tryStart(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))) "detalles" else "ninguna"
        }
    }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            BgLog.add("pantalla", when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> "apagada"
                Intent.ACTION_SCREEN_ON -> "encendida"
                Intent.ACTION_USER_PRESENT -> "desbloqueada"
                else -> intent?.action ?: "?"
            } + " · música sonando en el sistema: ${(getSystemService(Context.AUDIO_SERVICE) as AudioManager).isMusicActive}")
        }
    }

    /** Informe de segundo plano: datos del móvil, permisos y los últimos eventos. El usuario lo copia y lo envía. */
    fun bgReport(): String {
        val sb = StringBuilder()
        fun line(k: String, v: Any?) { sb.append(k).append(": ").append(v).append('\n') }
        line("Móvil", "${Build.MANUFACTURER} ${Build.MODEL} (${Build.BRAND})")
        line("Android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        line("Nsound", try { packageManager.getPackageInfo(packageName, 0).versionName } catch (_: Exception) { "?" })
        line("WebView", try { if (Build.VERSION.SDK_INT >= 26) WebView.getCurrentWebViewPackage()?.let { "${it.packageName} ${it.versionName}" } else "antiguo" } catch (_: Exception) { "?" })
        line("Script de arranque admitido", WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
        line("Restricción de batería quitada", try { (getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName) } catch (_: Exception) { "?" })
        line("Notificaciones permitidas", try { (getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).areNotificationsEnabled() } catch (_: Exception) { "?" })
        if (Build.VERSION.SDK_INT >= 33) line("Permiso de notificaciones concedido", checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED)
        if (Build.VERSION.SDK_INT >= 28) line("Grupo de espera de la app", try { (getSystemService(Context.USAGE_STATS_SERVICE) as android.app.usage.UsageStatsManager).appStandbyBucket } catch (_: Exception) { "?" })
        line("Servicio de música en marcha", PlaybackService.isRunning)
        line("Música sonando en el sistema", (getSystemService(Context.AUDIO_SERVICE) as AudioManager).isMusicActive)
        sb.append("\n--- Últimos eventos ---\n").append(BgLog.dump())
        return sb.toString()
    }

    override fun onResume() { super.onResume(); BgLog.add("actividad", "onResume") }

    private val lifecycleHandler = Handler(Looper.getMainLooper())

    /** Al salir, apagar la pantalla o desbloquear, el sistema puede pausar el reproductor de YouTube: se pide a la interfaz que reanude (solo si sonaba y no la pausó el usuario). */
    private fun resumeSoon() {
        lifecycleHandler.removeCallbacksAndMessages(null)
        for (delay in longArrayOf(100, 250, 400, 600, 900, 1300, 2000, 3000, 5000)) {
            lifecycleHandler.postDelayed({
                if (::web.isInitialized) web.evaluateJavascript("window.__nativeEvent && window.__nativeEvent({type:'remote',cmd:'resume'})", null)
            }, delay)
        }
    }

    override fun onPause() { super.onPause(); BgLog.add("actividad", "onPause"); resumeSoon() }

    override fun onStop() {
        super.onStop()
        BgLog.add("actividad", "onStop")
        if (::web.isInitialized) web.resumeTimers()      // que la página siga ejecutándose con la pantalla apagada
        resumeSoon()
    }

    override fun onStart() { super.onStart(); BgLog.add("actividad", "onStart"); resumeSoon() }

    override fun onDestroy() {
        BgLog.add("actividad", "onDestroy")
        try { unregisterReceiver(screenReceiver) } catch (_: Exception) { /* ya quitado */ }
        lifecycleHandler.removeCallbacksAndMessages(null)
        PlaybackService.listener = null
        PlaybackService.stop(this)
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val ASSET_HOST = "appassets.androidplatform.net"
        private const val BACKGROUND = 0xFF121214.toInt()
        private const val FILE_REQUEST = 4021
        private const val SAVE_REQUEST = 4022
    }
}
