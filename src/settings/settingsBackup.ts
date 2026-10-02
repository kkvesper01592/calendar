// 設定の控えを、PC の保存先フォルダの「最新\設定.json」にも置く(予定の控えと同じ考え方)。
// ブラウザのデータ(設定は localStorage)は、アプリの入れ直しなどでまとめて消えることがある。
// 保存先フォルダはブラウザの外なので残る。消えていたら、そこから戻す。
// 対象: この端末の設定すべて(見た目・週・休日・日付の背景色・テンプレート・既存カレンダーの編集の許可・
//       左の表示/非表示・予定の時刻/六曜の表示・表示の種類・オフライン表示・定期バックアップの間隔 など)

const FILE = '設定.json'
const LATEST = '最新'
const PREFIX = 'webcalendar.'
// 戻さないもの: 「2回目から確認画面なし」の印(戻した後の最初のログインは確認画面から)
const SKIP = new Set(['webcalendar.loggedIn'])

export interface SettingsFile {
  savedAt: string
  items: Record<string, string> // localStorage のキー → 値(そのまま)
}

/** 起動した時点で、この端末の設定が無かったか(入れ直し・データ削除の直後)。ほかの処理が書き込む前に調べる */
export const settingsWereMissing = (() => {
  try {
    return localStorage.getItem('webcalendar.prefs') === null
  } catch {
    return false
  }
})()

export function collectLocalSettings(): Record<string, string> {
  const items: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX) || SKIP.has(k)) continue
      items[k] = localStorage.getItem(k) ?? ''
    }
  } catch {
    /* 読めない環境 */
  }
  return items
}

/** 保存先フォルダの「最新」フォルダに設定の控えを書く(許可があるときだけ呼ぶ) */
export async function writeSettingsToFolder(root: FileSystemDirectoryHandle): Promise<void> {
  const items = collectLocalSettings()
  if (!items['webcalendar.prefs']) return // 設定がまだ無い(消えた直後)ときは、控えを空で上書きしない
  const dir = await root.getDirectoryHandle(LATEST, { create: true })
  const fh = await dir.getFileHandle(FILE, { create: true })
  const w = await fh.createWritable() // 一時ファイルに書いてから置き換わるので、途中で止まっても前回の分は壊れない
  const data: SettingsFile = { savedAt: new Date().toISOString(), items }
  await w.write(JSON.stringify(data, null, 2))
  await w.close()
}

/** 保存先フォルダから設定の控えを読む。選んだのが「最新」フォルダそのものでも読めるようにする */
export async function readSettingsFromFolder(root: FileSystemDirectoryHandle): Promise<SettingsFile | null> {
  const tryRead = async (dir: FileSystemDirectoryHandle) => {
    try {
      const data = JSON.parse(await (await (await dir.getFileHandle(FILE)).getFile()).text()) as SettingsFile
      return data?.items && data.items['webcalendar.prefs'] ? data : null
    } catch {
      return null
    }
  }
  try {
    const inLatest = await tryRead(await root.getDirectoryHandle(LATEST))
    if (inLatest) return inLatest
  } catch {
    /* 「最新」フォルダが無い */
  }
  return tryRead(root)
}

/** 控えの設定を、この端末に書き戻す(画面に反映するため、呼んだ側で再読み込みする) */
export function applyLocalSettings(data: SettingsFile): number {
  let n = 0
  try {
    for (const [k, v] of Object.entries(data.items)) {
      if (!k.startsWith(PREFIX) || SKIP.has(k)) continue
      localStorage.setItem(k, v)
      n++
    }
  } catch {
    /* 書けない環境 */
  }
  return n
}
