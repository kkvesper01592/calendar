// 予定のタイトルの入力候補(過去に入力したタイトル)。
// この端末に保存した予定の控え(全期間)とテンプレートから集める。比べ方は検索と同じ(全角/半角・大文字/小文字を区別しない)
import type { CalendarListEntry } from '../google/calendarReadApi'
import type { OfflineSnapshot } from '../offline/offlineStore'
import { normalizeText } from './highlight'

export interface TitleEntry {
  title: string
  count: number // 使った回数
  last: string // 最後に使った日(YYYY-MM-DD)。並べ替え用
  norm: string // 比べるための正規化した文字
}

// 候補に入れないカレンダー: 日付メモ・設定の保存用・祝日など他人の共有カレンダー
const skipCalendar = (c: CalendarListEntry) => {
  const d = typeof c.description === 'string' ? c.description : ''
  return d.includes('[WebCalendar:memo]') || d.includes('[WebCalendar:settings]') || /holiday@group\.v\.calendar\.google\.com$/.test(c.id)
}

/** 予定の控えとテンプレートから、タイトルの一覧を作る */
export function buildTitleIndex(snap: OfflineSnapshot | null | undefined, templateTitles: string[] = []): TitleEntry[] {
  const map = new Map<string, TitleEntry>()
  const add = (title: string | undefined, day: string) => {
    const t = (title ?? '').trim()
    if (!t || t.length > 80) return
    const cur = map.get(t)
    if (cur) {
      cur.count++
      if (day > cur.last) cur.last = day
    } else map.set(t, { title: t, count: 1, last: day, norm: normalizeText(t) })
  }
  if (snap) {
    for (const cal of snap.calendars) {
      if (skipCalendar(cal)) continue
      for (const ev of snap.events[cal.id] ?? []) add(ev.summary, (ev.start?.date ?? ev.start?.dateTime ?? '').slice(0, 10))
    }
  }
  for (const t of templateTitles) add(t, '9999') // テンプレートの名前は上の方に出す
  return [...map.values()]
}

/**
 * 入力中の文字に合う候補。前方一致を先に、その中は最近使った順(同じ日なら回数の多い順)。
 * 入力と同じタイトルだけになったときは出さない
 */
export function suggestTitles(index: TitleEntry[], input: string, limit = 8): TitleEntry[] {
  const q = normalizeText(input.trim())
  if (!q) return []
  const hits = index.filter((e) => e.norm.includes(q) && e.title !== input.trim())
  hits.sort((a, b) => {
    const pa = a.norm.startsWith(q) ? 0 : 1
    const pb = b.norm.startsWith(q) ? 0 : 1
    return pa - pb || b.last.localeCompare(a.last) || b.count - a.count
  })
  return hits.slice(0, limit)
}
