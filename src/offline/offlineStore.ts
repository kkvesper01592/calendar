// オフライン表示用に、予定をこの端末(ブラウザの IndexedDB)へ保存する。
// 設定で「この端末に保存する」をオンにした端末だけが使う。オフでは何も保存しない。
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
