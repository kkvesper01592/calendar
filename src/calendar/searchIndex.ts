import type { AccessToken } from '../google/auth'
import { listAllExpanded, type CalendarEvent, type CalendarListEntry } from '../google/calendarReadApi'
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
 * タイトル・メモ・場所から、文字の一部一致で予定を探す(Google の検索は日本語の文中の数字などに一致しないため)。
 * スペース区切りは「すべて含む」。結果は開始日時の古い順。
 * この端末に保存した予定があるカレンダーは、その中だけから探してネットにはつながない(通信量を抑えるため)。
 * 保存した予定はログイン時・30分ごと・「予定を更新」・予定の追加や変更のあとに、変わった分だけ読んで新しくしている
 */
export async function searchEvents(
  token: AccessToken | null,
  calendars: CalendarListEntry[],
  colors: Colors | null,
  query: string,
  reloadKey: number,
  onProgress?: (msg: string) => void,
  offline?: OfflineSnapshot | null, // オフライン中は、この端末に保存した予定から探す
  saved?: OfflineSnapshot | null, // オンラインでも、この端末に保存した予定があればそれから探す
): Promise<DisplayEvent[]> {
  if (cacheReloadKey !== reloadKey) {
    indexCache.clear()
    cacheReloadKey = reloadKey
  }
  const words = searchWords(query)
  const snap = offline ?? saved
  const found: DisplayEvent[] = []
  for (const [i, cal] of calendars.entries()) {
    let items = snap?.events[cal.id] ?? (offline ? [] : indexCache.get(cal.id))
    if (!items) {
      // 保存した予定が無いカレンダー(保存をオフにした端末・保存の後に増えたカレンダー)だけ Google から読む
      if (!token) break
      onProgress?.(`予定を読み込み中… (${i + 1}/${calendars.length})`)
      items = await listAllExpanded(token, cal.id)
      indexCache.set(cal.id, items)
    }
    for (const ev of items) if (ev.status !== 'cancelled' && ev.start && matches(ev, words)) found.push(toDisplay(ev, cal, colors))
  }
  found.sort((a, b) => eventRange(a.ev).start.getTime() - eventRange(b.ev).start.getTime())
  return found
}
