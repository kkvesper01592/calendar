package io.github.kkvesper01592.calendar

import android.content.Context
import java.io.File
import java.io.IOException
import java.security.MessageDigest

/**
 * 画面の保存場所(localStorage・IndexedDB の代わり)。アプリ専用の場所(内部ストレージの files/store)に置く。
 * ほかのアプリからは読めず、Chrome の「サイトデータの消去」の影響も受けない。アプリを消すと一緒に消える。
 */
class Store(context: Context) {
    val root = File(context.filesDir, "store").apply { mkdirs() }
    val localStorageFile = File(root, "localStorage.json")
    val journalFile = File(root, "journal.json")
    private val kvDir = File(root, "kv").apply { mkdirs() }

    fun kvFile(key: String): File {
        val h = MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(kvDir, "$h.json")
    }

    @Synchronized
    fun readText(f: File): String? = if (f.exists()) f.readText(Charsets.UTF_8) else null

    /** 一時ファイルに書いてから置き換える(途中で止まっても前回の内容は壊れない) */
    @Synchronized
    fun writeText(f: File, text: String) {
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeText(text, Charsets.UTF_8)
        if (!tmp.renameTo(f)) {
            f.delete()
            if (!tmp.renameTo(f)) throw IOException("保存できませんでした: ${f.name}")
        }
    }

    @Synchronized
    fun delete(f: File) {
        f.delete()
    }
}
