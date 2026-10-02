// オフライン表示用に、予定をこの端末(ブラウザの IndexedDB)へ保存する。
// 設定の「この端末に予定を保存する」(最初からオン)でオフにした端末では何も保存しない。
// 保存するのは閲覧・検索に必要な分(全カレンダーの予定を、繰り返しを展開して2年先まで)。
import type { AccessToken } from '../google/auth'
import { getColors, listAllExpanded, listCalendars, type CalendarEvent, type CalendarListEntry } from '../google/calendarReadApi'
import { idbDelete, idbGet, idbSet } from '../lib/idb'
import type { Colors } from '../calendar/useRangeEvents'

const KEY = 'offlineSnapshot'

export interface OfflineSnapshot {
  savedAt: string // 保存した日時(ISO)
  calendars: CalendarListEntry[]
  colors: Colors | null
  events: Record<string, CalendarEvent[]> // カレンダー ID → 予定
}

export const loadSnapshot = () => idbGet<OfflineSnapshot>(KEY)
export const clearSnapshot = () => idbDelete(KEY)

export const snapshotCount = (s: OfflineSnapshot) => Object.values(s.events).reduce((n, arr) => n + arr.length, 0)

/** Google から全カレンダーの予定を読み、この端末に保存する(削除済みは除く) */
export async function saveSnapshot(token: AccessToken, onProgress?: (msg: string) => void): Promise<OfflineSnapshot> {
  const [{ items: calendars }, colors] = await Promise.all([listCalendars(token), getColors(token)])
  const events: Record<string, CalendarEvent[]> = {}
  for (const [i, cal] of calendars.entries()) {
    onProgress?.(`オフライン用に保存中… (${i + 1}/${calendars.length})`)
    events[cal.id] = (await listAllExpanded(token, cal.id)).filter((e) => e.status !== 'cancelled' && e.start)
  }
  const snap: OfflineSnapshot = { savedAt: new Date().toISOString(), calendars, colors: colors as Colors, events }
  await idbSet(KEY, snap)
  return snap
}

/** 通信できなかったことによるエラーか(オフラインへの切り替えに使う) */
export function isNetworkError(e: unknown): boolean {
  return !navigator.onLine || (e instanceof TypeError && /fetch|network|Load failed/i.test(e.message))
}

// ---- 予定の控えを、PC の保存先フォルダにも置く(ブラウザのデータが消えても戻せるように) ----
// ブラウザのデータ(この端末の保存場所)は、アプリの入れ直しなどでまとめて消えることがある。
// 保存先フォルダ(PC・NAS)はブラウザの外なので消えない。そこの「最新」フォルダに同じ内容を置き、消えたらそこから戻す。
export const FOLDER_SNAPSHOT = '表示用の予定.json'
const LATEST = '最新'

/** 予定の控えを ブラウザの保存場所 に書く(フォルダから戻したとき用) */
export const putSnapshot = (snap: OfflineSnapshot) => idbSet(KEY, snap)

/** 保存先フォルダの「最新」フォルダに、予定の控えを書く(許可があるときだけ呼ぶ) */
export async function writeSnapshotToFolder(root: FileSystemDirectoryHandle, snap: OfflineSnapshot): Promise<void> {
  const dir = await root.getDirectoryHandle(LATEST, { create: true })
  const fh = await dir.getFileHandle(FOLDER_SNAPSHOT, { create: true })
  const w = await fh.createWritable() // 一時ファイルに書いてから置き換わるので、途中で止まっても前回の分は壊れない
  await w.write(JSON.stringify(snap))
  await w.close()
}

/** 保存先フォルダから予定の控えを読む。選んだのが「最新」フォルダそのものでも読めるようにする */
export async function readSnapshotFromFolder(root: FileSystemDirectoryHandle): Promise<OfflineSnapshot | null> {
  const tryRead = async (dir: FileSystemDirectoryHandle) => {
    try {
      const file = await (await dir.getFileHandle(FOLDER_SNAPSHOT)).getFile()
      const snap = JSON.parse(await file.text()) as OfflineSnapshot
      return snap?.savedAt && snap.calendars && snap.events ? snap : null
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
