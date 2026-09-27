import type { AccessToken } from '../google/auth'
import { listAllExpanded, type CalendarEvent, type CalendarListEntry } from '../google/calendarReadApi'
import { eventRange } from '../lib/dates'
import { toDisplay, type Colors, type DisplayEvent } from './useRangeEvents'
import { normalizeText, searchWords } from '../lib/highlight'
import type { OfflineSnapshot } from '../offline/offlineStore'

// 検索用に読み込んだ予定(メモリ上だけ)。「更新」を押すと読み直す
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
      onProgress?.(`予定を読み込み中… (${i + 1}/${calendars.length})`)
      items = await listAllExpanded(token, cal.id)
      indexCache.set(cal.id, items)
    }
    for (const ev of items) if (ev.status !== 'cancelled' && ev.start && matches(ev, words)) found.push(toDisplay(ev, cal, colors))
  }
  found.sort((a, b) => eventRange(a.ev).start.getTime() - eventRange(b.ev).start.getTime())
  return found
}
