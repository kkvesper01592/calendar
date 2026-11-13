package io.github.kkvesper01592.calendar

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.Executors

/** 画面からの要求(保存・ログイン)を受けて返事をする。約束は Windows 版の Bridge.cs と同じ */
class Bridge(
    private val activity: MainActivity,
    private val store: Store,
    private val auth: GoogleAuth,
) {
    private val io = Executors.newSingleThreadExecutor()
    private val journalLock = Any()

    class NetworkException(msg: String) : Exception(msg)
    class AbortException(msg: String) : Exception(msg)

    fun handle(json: String) {
        val req = try {
            JSONObject(json)
        } catch (e: Exception) {
            return
        }
        val id = req.optInt("id", 0)
        val method = req.optString("method")
        val args = req.optJSONObject("args") ?: JSONObject()
        val done: (Any?) -> Unit = { result ->
            if (id != 0) activity.reply(JSONObject().put("id", id).put("ok", true).put("result", result ?: JSONObject.NULL).toString())
        }
        val fail: (Throwable) -> Unit = { e ->
            MainActivity.log("$method: ${e.javaClass.simpleName} ${e.message}")
            val name: Any = when (e) {
                is NetworkException, is IOException -> "NetworkError"
                is AbortException -> "AbortError"
                else -> JSONObject.NULL
            }
            if (id != 0) activity.reply(
                JSONObject().put("id", id).put("ok", false).put("error", e.message ?: "エラーが起きました").put("errorName", name).toString(),
            )
        }
        when (method) {
            // ---- Google ログイン(必要なときだけ、Google の確認画面を出す) ----
            "auth.token" -> {
                val arr = args.optJSONArray("scopes") ?: JSONArray()
                val scopes = (0 until arr.length()).map { arr.getString(it) }
                auth.getToken(scopes, args.optBoolean("interactive"), { done(it) }, fail)
            }
            "auth.revoke" -> io.execute {
                try {
                    auth.revoke()
                    done(null)
                } catch (e: Exception) {
                    fail(e)
                }
            }
            else -> io.execute {
                try {
                    done(dispatchStore(method, args))
                } catch (e: Exception) {
                    fail(e)
                }
            }
        }
    }

    private fun dispatchStore(method: String, a: JSONObject): Any? {
        when (method) {
            // 設定(localStorage の代わり)
            "ls.save" -> store.writeText(store.localStorageFile, a.optString("json", "{}"))
            // 予定の控えなど(IndexedDB の代わり)
            "kv.get" -> return store.readText(store.kvFile(a.optString("key")))
            "kv.set" -> store.writeText(store.kvFile(a.optString("key")), a.optString("json"))
            "kv.delete" -> store.delete(store.kvFile(a.optString("key")))
            "journal.add" -> synchronized(journalLock) {
                val list = readJournal()
                list.put(a.optString("json"))
                store.writeText(store.journalFile, list.toString())
            }
            "journal.all" -> synchronized(journalLock) { return readJournal() }
            // フォルダの読み書きは Android 版には無い(画面側でフォルダ選択を出さない)
            else -> throw Exception("知らない要求です: $method")
        }
        return null
    }

    private fun readJournal(): JSONArray = store.readText(store.journalFile)?.let { JSONArray(it) } ?: JSONArray()
}
