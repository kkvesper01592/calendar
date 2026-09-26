import type { AccessToken } from '../google/auth'
import {
  getColors,
  getSettings,
  listAllEvents,
  listCalendars,
  type CalendarEvent,
  type CalendarListEntry,
} from '../google/calendarReadApi'

export interface CalendarBackup {
  calendar: CalendarListEntry
  eventsMeta?: Record<string, unknown>
  events: CalendarEvent[]
  error?: string
}

export interface FullBackup {
  format: 'webcalendar-full-backup'
  version: 1
  createdAt: string
  note: string
  calendarList: { meta: Record<string, unknown>; items: CalendarListEntry[] }
  settings: Record<string, unknown>[]
  colors: Record<string, unknown>
  calendars: CalendarBackup[]
}

export async function collectFullBackup(token: AccessToken, log: (msg: string) => void): Promise<FullBackup> {
  log('カレンダー一覧を取得中…')
  const calendarList = await listCalendars(token)
  log(`カレンダー ${calendarList.items.length} 件`)
  const settings = await getSettings(token)
  const colors = await getColors(token)

  const calendars: CalendarBackup[] = []
  for (const cal of calendarList.items) {
    const name = cal.summaryOverride || cal.summary
    try {
      const { items, firstPage } = await listAllEvents(token, cal.id, (n) => log(`「${name}」取得中… ${n} 件`))
      calendars.push({ calendar: cal, eventsMeta: firstPage, events: items })
      log(`「${name}」 ${items.length} 件 取得完了`)
    } catch (e) {
      // 閲覧権限が空き時間のみのカレンダーなどは失敗し得る。止めずに記録して続行
      const msg = e instanceof Error ? e.message : String(e)
      calendars.push({ calendar: cal, events: [], error: msg })
      log(`「${name}」 取得失敗: ${msg}`)
    }
  }

  return {
    format: 'webcalendar-full-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    note: 'Google Calendar API から読み取り専用で取得した生データ。繰り返し予定は親予定と例外(変更・削除された回)の形で保存。',
    calendarList: { meta: calendarList.firstPage, items: calendarList.items },
    settings: settings.items,
    colors,
    calendars,
  }
}
