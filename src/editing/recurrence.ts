// 繰り返し設定 <-> Google の繰り返しルール(RFC 5545 の RRULE)の変換と、日本語での説明

export type RepeatKind = 'none' | 'daily' | 'weekly' | 'monthlyDay' | 'monthlyNth' | 'monthlyLast' | 'yearly' | 'custom'

export interface RepeatForm {
  kind: RepeatKind
  interval: number // 何日・何週・何か月・何年ごと
  weekdays: number[] // 毎週: 0=日〜6=土
  monthDays: number[] // 毎月: 5,10,15 など
  nth: number // 毎月第n曜日: 1〜4、最終は -1
  nthWeekday: number
  endKind: 'never' | 'count' | 'until'
  count: number
  until: string // YYYY-MM-DD
  raw?: string // 対応していない複雑なルールはそのまま残す
  extras: string[] // EXDATE など RRULE 以外の行(消さずに引き継ぐ)
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const WD = ['日', '月', '火', '水', '木', '金', '土']

export function defaultRepeat(start: Date): RepeatForm {
  return {
    kind: 'none',
    interval: 1,
    weekdays: [start.getDay()],
    monthDays: [start.getDate()],
    nth: Math.min(Math.ceil(start.getDate() / 7), 4),
    nthWeekday: start.getDay(),
    endKind: 'never',
    count: 10,
    until: '',
    extras: [],
  }
}

/** 予定の recurrence(文字列の配列)から設定を読み取る */
export function parseRecurrence(lines: string[] | undefined, start: Date): RepeatForm {
  const f = defaultRepeat(start)
  if (!lines?.length) return f
  f.extras = lines.filter((l) => !l.startsWith('RRULE:'))
  const rule = lines.find((l) => l.startsWith('RRULE:'))
  if (!rule) return f
  const p = Object.fromEntries(
    rule
      .slice(6)
      .split(';')
      .map((kv) => kv.split('=') as [string, string]),
  )
  const unsupported = Object.keys(p).some((k) => !['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL', 'WKST'].includes(k))
  f.interval = Number(p.INTERVAL ?? 1)
  if (p.COUNT) {
    f.endKind = 'count'
    f.count = Number(p.COUNT)
  } else if (p.UNTIL) {
    f.endKind = 'until'
    f.until = `${p.UNTIL.slice(0, 4)}-${p.UNTIL.slice(4, 6)}-${p.UNTIL.slice(6, 8)}`
  }
  const custom = () => ({ ...f, kind: 'custom' as const, raw: rule })
  if (unsupported) return custom()

  switch (p.FREQ) {
    case 'DAILY':
      return p.BYDAY || p.BYMONTHDAY ? custom() : { ...f, kind: 'daily' }
    case 'WEEKLY': {
      const days = (p.BYDAY ?? DAYS[start.getDay()]).split(',').map((d: string) => DAYS.indexOf(d))
      return days.some((d: number) => d < 0) ? custom() : { ...f, kind: 'weekly', weekdays: days }
    }
    case 'MONTHLY': {
      if (p.BYMONTHDAY === '-1' && !p.BYDAY) return { ...f, kind: 'monthlyLast' }
      if (p.BYMONTHDAY && !p.BYDAY) {
        const days = p.BYMONTHDAY.split(',').map(Number)
        return days.some((d: number) => !(d >= 1 && d <= 31)) ? custom() : { ...f, kind: 'monthlyDay', monthDays: days }
      }
      const m = /^(-1|[1-4])(SU|MO|TU|WE|TH|FR|SA)$/.exec(p.BYDAY ?? '')
      if (m && !p.BYMONTHDAY) return { ...f, kind: 'monthlyNth', nth: Number(m[1]), nthWeekday: DAYS.indexOf(m[2]) }
      if (!p.BYDAY && !p.BYMONTHDAY) return { ...f, kind: 'monthlyDay', monthDays: [start.getDate()] }
      return custom()
    }
    case 'YEARLY':
      return p.BYDAY || p.BYMONTHDAY ? custom() : { ...f, kind: 'yearly' }
    default:
      return custom()
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 設定から Google に送る recurrence(配列)を作る。繰り返し無しなら空配列 */
export function buildRecurrence(f: RepeatForm, allDay: boolean): string[] {
  if (f.kind === 'none') return []
  if (f.kind === 'custom') return [f.raw!, ...f.extras]
  const parts: string[] = []
  const interval = f.interval > 1 ? [`INTERVAL=${f.interval}`] : []
  switch (f.kind) {
    case 'daily':
      parts.push('FREQ=DAILY', ...interval)
      break
    case 'weekly':
      parts.push('FREQ=WEEKLY', ...interval, `BYDAY=${[...f.weekdays].sort().map((d) => DAYS[d]).join(',')}`)
      break
    case 'monthlyDay':
      parts.push('FREQ=MONTHLY', ...interval, `BYMONTHDAY=${[...f.monthDays].sort((a, b) => a - b).join(',')}`)
      break
    case 'monthlyNth':
      parts.push('FREQ=MONTHLY', ...interval, `BYDAY=${f.nth}${DAYS[f.nthWeekday]}`)
      break
    case 'monthlyLast':
      parts.push('FREQ=MONTHLY', ...interval, 'BYMONTHDAY=-1')
      break
    case 'yearly':
      parts.push('FREQ=YEARLY', ...interval)
      break
  }
  if (f.endKind === 'count') parts.push(`COUNT=${Math.max(1, f.count)}`)
  if (f.endKind === 'until' && f.until) {
    const [y, m, d] = f.until.split('-').map(Number)
    if (allDay) parts.push(`UNTIL=${y}${pad(m)}${pad(d)}`)
    else {
      const u = new Date(y, m - 1, d, 23, 59, 59) // その日の終わり(日本時間)を UTC で
      parts.push(`UNTIL=${u.getUTCFullYear()}${pad(u.getUTCMonth() + 1)}${pad(u.getUTCDate())}T${pad(u.getUTCHours())}${pad(u.getUTCMinutes())}${pad(u.getUTCSeconds())}Z`)
    }
  }
  return [`RRULE:${parts.join(';')}`, ...f.extras]
}

/** 繰り返しの日本語説明(例: 毎月 第2火曜日(10回)) */
export function describeRepeat(f: RepeatForm): string {
  const n = f.interval
  let s: string
  switch (f.kind) {
    case 'none':
      return '繰り返さない'
    case 'custom':
      return '独自の繰り返し(Google カレンダーで設定されたもの)'
    case 'daily':
      s = n > 1 ? `${n}日ごと` : '毎日'
      break
    case 'weekly':
      s = `${n > 1 ? `${n}週間ごと` : '毎週'} ${[...f.weekdays].sort().map((d) => WD[d]).join('・')}曜日`
      break
    case 'monthlyDay':
      s = `${n > 1 ? `${n}か月ごと` : '毎月'} ${[...f.monthDays].sort((a, b) => a - b).join('日・')}日`
      break
    case 'monthlyNth':
      s = `${n > 1 ? `${n}か月ごと` : '毎月'} ${f.nth === -1 ? '最終' : `第${f.nth}`}${WD[f.nthWeekday]}曜日`
      break
    case 'monthlyLast':
      s = `${n > 1 ? `${n}か月ごと` : '毎月'} 末日`
      break
    case 'yearly':
      s = n > 1 ? `${n}年ごと` : '毎年'
      break
  }
  if (f.endKind === 'count') s += `(${f.count}回)`
  if (f.endKind === 'until' && f.until) s += `(${f.until.replace(/-/g, '/')}まで)`
  return s
}
