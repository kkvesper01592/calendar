import type { CalendarEvent } from '../google/calendarReadApi'
import { addDays, eventRange, hhmm, isAllDay, localIso, ymd } from '../lib/dates'
import { eventMapUrl } from '../lib/maps'

/** よく使う予定のひな形(シフト・定例など)。この端末に保存 */
export interface Template {
  id: string
  title: string
  allDay: boolean
  startTime: string // HH:MM(終日なら無視)
  minutes: number // 長さ(分)。終日なら日数×1440
  calendarId?: string
  colorId?: string
  location?: string
  mapUrl?: string
  description?: string
  reminders?: CalendarEvent['reminders']
}

const KEY = 'webcalendar.templates'

export function loadTemplates(): Template[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Template[]
  } catch {
    return []
  }
}

export function saveTemplates(list: Template[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 保存できない環境 */
  }
}

export const newTemplateId = () => `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`

/** 予定からひな形を作る(読み取るだけなので閲覧専用カレンダーの予定からでも作れる) */
export function templateFromEvent(ev: CalendarEvent, calendarId?: string): Template {
  const { start, end } = eventRange(ev)
  const allDay = isAllDay(ev)
  return {
    id: newTemplateId(),
    title: ev.summary ?? '',
    allDay,
    startTime: allDay ? '09:00' : hhmm(start),
    minutes: Math.max(allDay ? 1440 : 15, Math.round((end.getTime() - start.getTime()) / 60000)),
    calendarId,
    colorId: typeof ev.colorId === 'string' ? ev.colorId : undefined,
    location: ev.location || undefined,
    mapUrl: eventMapUrl(ev),
    description: ev.description || undefined,
    reminders: ev.reminders,
  }
}

/** 時間帯の表示(例 07:00–15:30)。startAt を渡すとその時刻から始めた場合 */
export function describeTemplate(t: Template, startAt?: Date): string {
  if (t.allDay) return t.minutes > 1440 ? `終日(${Math.round(t.minutes / 1440)}日間)` : '終日'
  const [h, m] = startAt ? [startAt.getHours(), startAt.getMinutes()] : t.startTime.split(':').map(Number)
  const endMin = h * 60 + m + t.minutes
  const eh = Math.floor(endMin / 60)
  const startLabel = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  return `${startLabel}–${eh >= 24 ? `翌${String(eh - 24).padStart(2, '0')}` : String(eh).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`
}

/** 開始時刻の決め方: テンプレートの時刻 / その日の最後の予定の後 */
export type TemplateTimeMode = 'template' | 'after'
const MODE_KEY = 'webcalendar.templateTimeMode'
export function loadTimeMode(): TemplateTimeMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'after' ? 'after' : 'template'
  } catch {
    return 'template'
  }
}
export function saveTimeMode(m: TemplateTimeMode) {
  try {
    localStorage.setItem(MODE_KEY, m)
  } catch {
    /* 保存できない環境 */
  }
}

/** ひな形を、指定した日の予定(Google に送る形)にする。startAt を渡すとその時刻から(長さはひな形のまま) */
export function templateToEvent(t: Template, date: Date, startAt?: Date): Partial<CalendarEvent> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'
  const body: Partial<CalendarEvent> = { summary: t.title }
  if (t.allDay) {
    body.start = { date: ymd(date) }
    body.end = { date: ymd(addDays(date, Math.max(1, Math.round(t.minutes / 1440)))) }
  } else {
    const [h, m] = t.startTime.split(':').map(Number)
    const s = startAt ?? new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m)
    body.start = { dateTime: localIso(s), timeZone: zone }
    body.end = { dateTime: localIso(new Date(s.getTime() + t.minutes * 60000)), timeZone: zone }
  }
  if (t.colorId) body.colorId = t.colorId
  if (t.location) body.location = t.location
  if (t.description) body.description = t.description
  if (t.reminders) body.reminders = t.reminders
  if (t.mapUrl) body.extendedProperties = { private: { mapUrl: t.mapUrl } }
  return body
}
