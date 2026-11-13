package io.github.kkvesper01592.calendar

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * 予定表(WebCalendar)の Android 版。
 * 画面は Web 版と同じもの(APK の中に入れた dist)を WebView で表示し、
 * ログイン(Google Play 開発者サービス)と保存(アプリ専用の場所)をアプリ側が受け持つ。
 * Windows 版(WebCalendarDesktop)と同じ約束で画面とやり取りする(src/desktop/host.ts)。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var store: Store
    lateinit var auth: GoogleAuth
        private set
    private lateinit var bridge: Bridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        auth = GoogleAuth(this)
        bridge = Bridge(this, store, auth)

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#15171b"))
        // Android 15 以降は画面がステータスバー・ナビゲーションバーの下まで広がるので、
        // その分(と、キーボードが出ているときはキーボードの分)だけ外側に余白を取り、画面のボタンと重ならないようにする
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#15171b"))
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)

        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.setSupportMultipleWindows(false) // window.open / target=_blank は shouldOverrideUrlLoading に来る
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.textZoom = 100

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.host != HOST) return null
                // assets/web/calendar/... を https://appassets.androidplatform.net/calendar/... として出す
                val path = request.url.path ?: return null
                return loader.shouldInterceptRequest(request.url.buildUpon().path("/web$path").build())
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOST) return false
                openExternal(request.url) // 地図・予定の中のリンクなどは普段のブラウザ(地図アプリ)で開く
                return true
            }
        }

        web.addJavascriptInterface(JsApi(), "WebCalendarAndroid")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
            }
        })

        web.loadUrl(START_URL)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    /** 画面への返事(host.ts の受け取り口へ渡す) */
    fun reply(json: String) {
        runOnUiThread {
            web.evaluateJavascript("window.__webCalendarReply && window.__webCalendarReply(${JSONObject.quote(json)})", null)
        }
    }

    private fun openExternal(uri: Uri) {
        if (uri.scheme != "https" && uri.scheme != "http" && uri.scheme != "geo") return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "開けるアプリがありません", Toast.LENGTH_SHORT).show()
        }
    }

    /** 画面(JavaScript)から呼ぶ窓口。名前は Windows 版の DesktopSync と同じ */
    @Suppress("FunctionName")
    inner class JsApi {
        @JavascriptInterface
        fun GetLocalStorage(): String = try {
            store.readText(store.localStorageFile) ?: "{}"
        } catch (e: Exception) {
            "{}"
        }

        @JavascriptInterface
        fun HasLogin(): Boolean = auth.hasLogin

        @JavascriptInterface
        fun Version(): String = BuildConfig.VERSION_NAME

        /** 非同期の要求({id, method, args} の JSON)。返事は reply() で返す */
        @JavascriptInterface
        fun postMessage(json: String) {
            bridge.handle(json)
        }
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val START_URL = "https://$HOST/calendar/index.html"
        fun log(msg: String) = Log.i("WebCalendar", msg)
    }
}
