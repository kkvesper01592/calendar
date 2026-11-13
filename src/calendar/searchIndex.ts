import type { AccessToken } from '../google/auth'
import { AuthExpiredError, listAllExpanded, listChangedSince, type CalendarEvent, type CalendarListEntry } from '../google/calendarReadApi'
import { eventRange } from '../lib/dates'
import { toDisplay, type Colors, type DisplayEvent } from './useRangeEvents'
import { normalizeText, searchWords } from '../lib/highlight'
import type { OfflineSnapshot } from '../offline/offlineStore'

// 検索用に読み込んだ予定(メモリ上だけ)。「予定を更新」を押すと読み直す
const indexCache = new Map<string, CalendarEvent[]>()
let cacheReloadKey = -1

/** 全角/半角・大文字/小文字・数字のカンマ区切りの違いを無視して比べるための正規化(説明欄の HTML タグは除く) */
const normalize = (s: string | undefined) => normalizeText((s ?? '').replace(/<[^>]*>/g, ' '))

function matches(ev: CalendarEvent, words: string[]): boolean {
  const text = normalize([ev.summary, ev.description, ev.location].join('\n'))
  return words.every((w) => text.includes(w))
}

/**
 * 端末に保存した予定に、保存した後で Google 側で追加・変更・削除された分を重ねる。
 * 差分が読めなかった(通信できない等)ときは保存した予定のまま探す
 */
async function withChanges(token: AccessToken, calendarId: string, base: CalendarEvent[], savedAt: string): Promise<CalendarEvent[]> {
  // 保存の途中で変わった予定を取りこぼさないよう、保存した時刻より少し前からの変更を読む
  const since = new Date(new Date(savedAt).getTime() - 10 * 60_000)
  let changes: CalendarEvent[]
  try {
    changes = await listChangedSince(token, calendarId, since)
  } catch (e) {
    if (e instanceof AuthExpiredError) throw e
    return base
  }
  if (!changes.length) return base
  const byId = new Map(base.map((ev) => [ev.id, ev]))
  for (const ev of changes) {
    if (ev.status === 'cancelled' || !ev.start) byId.delete(ev.id)
    else byId.set(ev.id, ev)
  }
  return [...byId.values()]
}

/**
 * タイトル・メモ・場所から、文字の一部一致で予定を探す(Google の検索は日本語の文中の数字などに一致しないため)。
 * スペース区切りは「すべて含む」。結果は開始日時の古い順
 */
export async function searchEvents(
  token: AccessToken | null,
  calendars: CalendarListEntry[],
  colors: Colors | null,
  query: string,
  reloadKey: number,
  onProgress?: (msg: string) => void,
  offline?: OfflineSnapshot | null, // オフライン中は、この端末に保存した予定から探す
  saved?: OfflineSnapshot | null, // オンラインでも、この端末に保存した予定があれば、それ+保存後に変わった分だけを読んで探す(全部読み直すと遅い)
): Promise<DisplayEvent[]> {
  if (cacheReloadKey !== reloadKey) {
    indexCache.clear()
    cacheReloadKey = reloadKey
  }
  const words = searchWords(query)
  const found: DisplayEvent[] = []
  for (const [i, cal] of calendars.entries()) {
    let items = offline ? (offline.events[cal.id] ?? []) : indexCache.get(cal.id)
    if (!items) {
      if (!token) break
      const base = saved?.events[cal.id]
      if (base) {
        onProgress?.(`最新の変更を確認中… (${i + 1}/${calendars.length})`)
        items = await withChanges(token, cal.id, base, saved!.savedAt)
      } else {
        onProgress?.(`予定を読み込み中… (${i + 1}/${calendars.length})`)
        items = await listAllExpanded(token, cal.id)
      }
      indexCache.set(cal.id, items)
    }
    for (const ev of items) if (ev.status !== 'cancelled' && ev.start && matches(ev, words)) found.push(toDisplay(ev, cal, colors))
  }
  found.sort((a, b) => eventRange(a.ev).start.getTime() - eventRange(b.ev).start.getTime())
  return found
}
