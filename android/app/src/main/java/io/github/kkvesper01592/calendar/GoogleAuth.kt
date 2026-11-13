package io.github.kkvesper01592.calendar

import android.accounts.Account
import android.app.Activity
import android.content.Context
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * Google へのログイン。Google Play 開発者サービスの AuthorizationClient を使う。
 * - 初回だけ Google の確認画面(アカウント選択と許可)が出る。
 * - 2回目からは確認画面なしでアクセストークン(1時間有効)をもらえる。
 *   合鍵(リフレッシュトークン)は Google Play 開発者サービスが端末の Google アカウントと一緒に管理するので、
 *   このアプリは合鍵を持たない。Chrome のサイトデータを消しても、アプリを閉じてもログインは消えない。
 * - アプリの見分けは「パッケージ名 + 署名の鍵の SHA-1」。Google Cloud に Android 用 OAuth クライアントとして登録が必要。
 */
class GoogleAuth(private val activity: MainActivity) {
    private val prefs = activity.getSharedPreferences("auth", Context.MODE_PRIVATE)
    private val client = Identity.getAuthorizationClient(activity)
    private val net = Executors.newSingleThreadExecutor()

    /** 一度ログインした(次からは起動時に自動でつなぐ) */
    val hasLogin: Boolean get() = prefs.getBoolean(KEY_GRANTED, false)
    private val account: String? get() = prefs.getString(KEY_ACCOUNT, null)
    @Volatile private var lastToken: String? = null

    private class Pending(val scopes: List<String>, val ok: (JSONObject) -> Unit, val err: (Throwable) -> Unit)
    private var pending: Pending? = null

    /** Google の確認画面から戻ったとき */
    private val consent = activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        val p = pending ?: return@registerForActivityResult
        pending = null
        if (res.resultCode != Activity.RESULT_OK) {
            p.err(Exception("ログイン画面が閉じられました"))
            return@registerForActivityResult
        }
        try {
            finish(client.getAuthorizationResultFromIntent(res.data), p, retried = false)
        } catch (e: Exception) {
            p.err(mapError(e))
        }
    }

    /**
     * アクセストークンをもらう。interactive=false のときは確認画面を出さず、必要なら失敗する(起動時の自動ログイン)。
     * 返事は Windows 版と同じ形 {access_token, expires_in, scope}
     */
    fun getToken(scopes: List<String>, interactive: Boolean, ok: (JSONObject) -> Unit, err: (Throwable) -> Unit) {
        activity.runOnUiThread {
            if (pending != null) {
                err(Exception("ログインの確認画面を開いています"))
                return@runOnUiThread
            }
            request(Pending(scopes, ok, err), interactive, retried = false)
        }
    }

    private fun request(p: Pending, interactive: Boolean, retried: Boolean) {
        // email はアカウントを覚えるため(次回から同じアカウントで、選択画面なしにつなぐ)
        val all = (p.scopes + SCOPE_EMAIL).distinct().map { Scope(it) }
        val b = AuthorizationRequest.builder().setRequestedScopes(all)
        account?.let { b.setAccount(Account(it, "com.google")) }
        client.authorize(b.build())
            .addOnSuccessListener { r ->
                if (r.hasResolution()) {
                    if (!interactive) {
                        // 許可が取り消された・アカウントが端末から消えたなど。次の起動では自動でつながず、ログイン画面を出す
                        prefs.edit().putBoolean(KEY_GRANTED, false).apply()
                        p.err(Exception("Google へのログインが必要です。「Google にログイン」を押してください"))
                        return@addOnSuccessListener
                    }
                    pending = p
                    try {
                        consent.launch(IntentSenderRequest.Builder(r.pendingIntent!!.intentSender).build())
                    } catch (e: Exception) {
                        pending = null
                        p.err(e)
                    }
                } else {
                    finish(r, p, retried)
                }
            }
            .addOnFailureListener { e -> p.err(mapError(e)) }
    }

    /** トークンの残り時間と、許可された範囲・アカウントを Google に確かめてから返す */
    private fun finish(r: AuthorizationResult, p: Pending, retried: Boolean) {
        val token = r.accessToken
        if (token.isNullOrEmpty()) {
            p.err(Exception("Google からトークンをもらえませんでした"))
            return
        }
        net.execute {
            try {
                val info = tokenInfo(token)
                val expiresIn = info.optString("expires_in", "0").toLongOrNull() ?: 0
                if (expiresIn < 120 && !retried) {
                    // 期限切れ間近の控えを渡されたときは、捨ててもらい直す
                    GoogleAuthUtil.clearToken(activity, token)
                    activity.runOnUiThread { request(p, interactive = false, retried = true) }
                    return@execute
                }
                val scope = info.optString("scope").ifEmpty { r.grantedScopes.joinToString(" ") }
                val email = info.optString("email")
                prefs.edit().putBoolean(KEY_GRANTED, true).apply {
                    if (email.isNotEmpty()) putString(KEY_ACCOUNT, email)
                }.apply()
                lastToken = token
                p.ok(JSONObject().put("access_token", token).put("expires_in", expiresIn).put("scope", scope))
            } catch (e: Exception) {
                p.err(mapError(e))
            }
        }
    }

    /** ログアウト: Google 側の許可を取り消し、このアプリの記録も消す(呼ぶのは裏の処理から) */
    fun revoke() {
        val t = lastToken
        prefs.edit().clear().apply()
        lastToken = null
        if (t != null) {
            try {
                post("https://oauth2.googleapis.com/revoke", "token=" + URLEncoder.encode(t, "UTF-8"))
            } catch (e: Exception) {
                MainActivity.log("revoke: ${e.message}")
            }
            try {
                GoogleAuthUtil.clearToken(activity, t)
            } catch (e: Exception) {
                MainActivity.log("clearToken: ${e.message}")
            }
        }
    }

    private fun tokenInfo(token: String): JSONObject {
        val (code, body) = post("https://oauth2.googleapis.com/tokeninfo", "access_token=" + URLEncoder.encode(token, "UTF-8"))
        if (code != 200) throw Exception("Google でトークンを確認できませんでした(${code})")
        return JSONObject(body)
    }

    private fun post(url: String, form: String): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 15000
            c.readTimeout = 15000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            c.outputStream.use { it.write(form.toByteArray()) }
            val code = c.responseCode
            val body = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            return code to body
        } finally {
            c.disconnect()
        }
    }

    private fun mapError(e: Throwable): Throwable {
        if (e is IOException) return Bridge.NetworkException(e.message ?: "通信できませんでした")
        if (e is ApiException) {
            return when (e.statusCode) {
                CommonStatusCodes.NETWORK_ERROR -> Bridge.NetworkException("通信できませんでした")
                CommonStatusCodes.DEVELOPER_ERROR -> Exception(
                    "Google がこのアプリを認識できませんでした(コード10)。Google Cloud に Android 用の OAuth クライアント" +
                        "(パッケージ名 ${activity.packageName} と署名の SHA-1)が登録されているか確認してください",
                )
                CommonStatusCodes.CANCELED -> Exception("ログイン画面が閉じられました")
                CommonStatusCodes.SIGN_IN_REQUIRED -> Exception("この端末に Google アカウントを追加してください(設定 → パスワードとアカウント)")
                else -> Exception("Google にログインできませんでした(コード${e.statusCode}): ${e.message ?: ""}")
            }
        }
        return e
    }

    companion object {
        private const val KEY_GRANTED = "granted"
        private const val KEY_ACCOUNT = "account"
        private const val SCOPE_EMAIL = "email"
    }
}
