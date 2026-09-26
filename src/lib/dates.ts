import type { CalendarEvent } from '../google/calendarReadApi'

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b)

/** 月表示の6週分の先頭日と、その翌日(=終端・排他)。weekStart: 0=日曜始まり 1=月曜始まり */
export function monthGrid(year: number, month0: number, weekStart = 0): { start: Date; end: Date; days: Date[] } {
  const first = new Date(year, month0, 1)
  const start = addDays(first, -((first.getDay() - weekStart + 7) % 7))
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  return { start, end: addDays(start, 42), days }
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const startOfWeek = (d: Date, weekStart = 0) => addDays(startOfDay(d), -((d.getDay() - weekStart + 7) % 7))

export type ViewKind = 'year' | 'month' | 'week' | 'day'

export interface WeekOpts {
  weekStart: number // 0=日曜 1=月曜
  weekDays: 7 | 5 | 3 // 週表示の日数(5=月〜金、3=選んだ日から3日)
}
const DEFAULT_WEEK: WeekOpts = { weekStart: 0, weekDays: 7 }

/** 週表示に並べる日 */
export function weekDaysOf(cursor: Date, o: WeekOpts = DEFAULT_WEEK): Date[] {
  if (o.weekDays === 3) return [0, 1, 2].map((i) => addDays(startOfDay(cursor), i))
  if (o.weekDays === 5) {
    const mon = startOfWeek(cursor, 1)
    return [0, 1, 2, 3, 4].map((i) => addDays(mon, i))
  }
  const s = startOfWeek(cursor, o.weekStart)
  return Array.from({ length: 7 }, (_, i) => addDays(s, i))
}

/** 各表示で読み込む期間(終端は排他) */
export function viewRange(view: ViewKind, cursor: Date, o: WeekOpts = DEFAULT_WEEK): { start: Date; end: Date } {
  switch (view) {
    case 'year':
      return { start: new Date(cursor.getFullYear(), 0, 1), end: new Date(cursor.getFullYear() + 1, 0, 1) }
    case 'month': {
      const { start, end } = monthGrid(cursor.getFullYear(), cursor.getMonth(), o.weekStart)
      return { start, end }
    }
    case 'week': {
      const days = weekDaysOf(cursor, o)
      return { start: days[0], end: addDays(days[days.length - 1], 1) }
    }
    case 'day':
      return { start: startOfDay(cursor), end: addDays(startOfDay(cursor), 1) }
  }
}

/** 前後の期間へ移動 */
export function shiftCursor(view: ViewKind, cursor: Date, n: number, o: WeekOpts = DEFAULT_WEEK): Date {
  switch (view) {
    case 'year':
      return new Date(cursor.getFullYear() + n, cursor.getMonth(), 1)
    case 'month':
      return new Date(cursor.getFullYear(), cursor.getMonth() + n, 1)
    case 'week':
      return addDays(cursor, (o.weekDays === 3 ? 3 : 7) * n)
    case 'day':
      return addDays(cursor, n)
  }
}

export function viewTitle(view: ViewKind, cursor: Date, o: WeekOpts = DEFAULT_WEEK): string {
  const y = cursor.getFullYear()
  const m = cursor.getMonth() + 1
  switch (view) {
    case 'year':
      return `${y}年`
    case 'month':
      return `${y}年${m}月`
    case 'week': {
      const days = weekDaysOf(cursor, o)
      const s = days[0]
      const e = days[days.length - 1]
      return s.getMonth() === e.getMonth()
        ? `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日〜${e.getDate()}日`
        : `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日〜${e.getMonth() + 1}月${e.getDate()}日`
    }
    case 'day':
      return `${y}年${m}月${cursor.getDate()}日(${WEEKDAYS[cursor.getDay()]})`
  }
}

export const mdw = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`

/** 端末の時刻を、時差つきの RFC3339 で(例: 2026-09-26T09:00:00+09:00)。どのタイムゾーンでも同じ瞬間を指す */
export function localIso(d: Date): string {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  return `${ymd(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(off / 60)}:${p(off % 60)}`
}

export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export const isAllDay = (ev: CalendarEvent) => !!ev.start?.date

/** 予定の開始と終了(終了は排他)をローカル日時で */
export function eventRange(ev: CalendarEvent): { start: Date; end: Date } {
  if (ev.start?.date) {
    const [y, m, d] = ev.start.date.split('-').map(Number)
    const [y2, m2, d2] = (ev.end?.date ?? ev.start.date).split('-').map(Number)
    return { start: new Date(y, m - 1, d), end: new Date(y2, m2 - 1, d2) }
  }
  const start = new Date(ev.start!.dateTime!)
  const end = ev.end?.dateTime ? new Date(ev.end.dateTime) : start
  return { start, end }
}

/** 予定がかかっている日付キー(YYYY-MM-DD)の一覧 */
export function eventDayKeys(ev: CalendarEvent): string[] {
  const { start, end } = eventRange(ev)
  const keys: string[] = []
  let d = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  // 時間指定の予定は終了時刻ちょうど0時なら前日まで
  const last = isAllDay(ev) ? addDays(end, -1) : new Date(end.getTime() - 1)
  const lastKey = ymd(last < start ? start : last)
  for (let i = 0; i < 366; i++) {
    const k = ymd(d)
    keys.push(k)
    if (k >= lastKey) break
    d = addDays(d, 1)
  }
  return keys
}

/** 予定の日時を人が読む形で(例: 9月25日(金) 18:00 – 19:00) */
export function describeWhen(ev: CalendarEvent): string {
  const { start, end } = eventRange(ev)
  if (isAllDay(ev)) {
    const last = addDays(end, -1)
    return sameDay(start, last) || last < start ? `${mdw(start)} 終日` : `${mdw(start)} 〜 ${mdw(last)} 終日`
  }
  const y = start.getFullYear() !== new Date().getFullYear() ? `${start.getFullYear()}年` : ''
  return sameDay(start, end)
    ? `${y}${mdw(start)} ${hhmm(start)} – ${hhmm(end)}`
    : `${y}${mdw(start)} ${hhmm(start)} – ${mdw(end)} ${hhmm(end)}`
}

/** その日の中での時刻表示(日をまたぐ予定は「前日から」「翌日へ」) */
export function timeOnDay(ev: CalendarEvent, day: Date): string {
  if (isAllDay(ev)) return '終日'
  const { start, end } = eventRange(ev)
  const s = sameDay(start, day) ? hhmm(start) : '前日から'
  const e = sameDay(end, day) || (end.getHours() === 0 && end.getMinutes() === 0 && sameDay(end, addDays(day, 1))) ? hhmm(end) : '翌日へ'
  return `${s} – ${e}`
}

/** その日の中での開始・終了(上下2段の表示用)。日をまたぐ予定は「前日から」「翌日へ」 */
export function timesOnDay(ev: CalendarEvent, day: Date): { start: string; end: string } | null {
  if (isAllDay(ev)) return null
  const { start, end } = eventRange(ev)
  return {
    start: sameDay(start, day) ? hhmm(start) : '前日から',
    end: sameDay(end, day) || (end.getHours() === 0 && end.getMinutes() === 0 && sameDay(end, addDays(day, 1))) ? hhmm(end) : '翌日へ',
  }
}

/** メモ(説明欄。HTML のこともある)の最初の1行 */
export function firstLine(description: string | undefined): string {
  if (!description) return ''
  const text = description
    .replace(/<br\s*\/?>|<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
  return text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
}

/** 背景色に対して読みやすい文字色 */
export function textOn(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg)
  if (!m) return '#fff'
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#1f2328' : '#fff'
}
