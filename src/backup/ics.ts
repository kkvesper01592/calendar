import type { CalendarEvent, EventDateTime } from '../google/calendarReadApi'
import type { CalendarBackup } from './collect'

// RFC 5545 のテキストエスケープ
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

// 1行75オクテットで折り返す(UTF-8 の文字途中では切らない)
function fold(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let curLen = 0
  for (const ch of line) {
    const len = enc.encode(ch).length
    if (curLen + len > (out.length ? 74 : 75)) {
      out.push(cur)
      cur = ''
      curLen = 0
    }
    cur += ch
    curLen += len
  }
  out.push(cur)
  return out.join('\r\n ')
}

function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// 指定タイムゾーンでの壁時計時刻 YYYYMMDDTHHMMSS
function localStamp(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const g = (t: string) => parts.find((p) => p.type === t)!.value
  return `${g('year')}${g('month')}${g('day')}T${g('hour')}${g('minute')}${g('second')}`
}

function dateProp(name: string, dt: EventDateTime | undefined, fallbackTz: string | undefined): string | null {
  if (!dt) return null
  if (dt.date) return `${name};VALUE=DATE:${dt.date.replace(/-/g, '')}`
  if (!dt.dateTime) return null
  const tz = dt.timeZone || fallbackTz
  if (tz) {
    try {
      return `${name};TZID=${tz}:${localStamp(dt.dateTime, tz)}`
    } catch {
      /* 不明なタイムゾーンは UTC で書く */
    }
  }
  return `${name}:${utcStamp(dt.dateTime)}`
}

function eventLines(ev: CalendarEvent, calTz: string | undefined, exdates: string[], nowStamp: string): string[] {
  const L: string[] = ['BEGIN:VEVENT']
  L.push(`UID:${ev.iCalUID || ev.id}`)
  L.push(`DTSTAMP:${nowStamp}`)
  const s = dateProp('DTSTART', ev.start, calTz)
  const e = dateProp('DTEND', ev.end, calTz)
  if (s) L.push(s)
  if (e) L.push(e)
  for (const r of ev.recurrence ?? []) L.push(r)
  L.push(...exdates)
  if (ev.recurringEventId) {
    const rid = dateProp('RECURRENCE-ID', ev.originalStartTime, calTz)
    if (rid) L.push(rid)
  }
  if (ev.summary) L.push(`SUMMARY:${esc(ev.summary)}`)
  if (ev.description) L.push(`DESCRIPTION:${esc(ev.description)}`)
  if (ev.location) L.push(`LOCATION:${esc(ev.location)}`)
  if (ev.status) L.push(`STATUS:${ev.status.toUpperCase()}`)
  if (ev.transparency) L.push(`TRANSP:${ev.transparency.toUpperCase()}`)
  if (ev.created) L.push(`CREATED:${utcStamp(ev.created)}`)
  if (ev.updated) L.push(`LAST-MODIFIED:${utcStamp(ev.updated)}`)
  if (typeof ev.sequence === 'number') L.push(`SEQUENCE:${ev.sequence}`)
  for (const o of ev.reminders?.overrides ?? []) {
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.summary || 'リマインダー')}`, `TRIGGER:-PT${o.minutes}M`, 'END:VALARM')
  }
  L.push('END:VEVENT')
  return L
}

/** カレンダー1つ分を .ics 文字列にする(Google カレンダーへ再インポート可能な形式) */
export function toIcs(cb: CalendarBackup): string {
  const cal = cb.calendar
  const tz = cal.timeZone
  const nowStamp = utcStamp(new Date().toISOString())

  // 削除された繰り返しの回は、親予定の EXDATE として表現する
  const exdatesByParent = new Map<string, string[]>()
  for (const ev of cb.events) {
    if (ev.status === 'cancelled' && ev.recurringEventId) {
      const line = dateProp('EXDATE', ev.originalStartTime, tz)
      if (!line) continue
      const arr = exdatesByParent.get(ev.recurringEventId) ?? []
      arr.push(line)
      exdatesByParent.set(ev.recurringEventId, arr)
    }
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WebCalendar//Backup//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(cal.summaryOverride || cal.summary)}`,
  ]
  if (tz) lines.push(`X-WR-TIMEZONE:${tz}`)
  for (const ev of cb.events) {
    if (ev.status === 'cancelled') continue // 削除済み(単発)と削除済みの回は書かない
    lines.push(...eventLines(ev, tz, exdatesByParent.get(ev.id) ?? [], nowStamp))
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
