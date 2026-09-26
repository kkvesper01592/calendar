import type { AccessToken } from './auth'

// このモジュールは GET リクエストしか送らない。書き込み系の関数は意図的に存在しない。
const BASE = 'https://www.googleapis.com/calendar/v3'

// Google Calendar API のリソース型(バックアップでは生データをそのまま保存するので必要な項目だけ定義)
export interface CalendarListEntry {
  id: string
  summary: string
  summaryOverride?: string
  timeZone?: string
  accessRole: string
  primary?: boolean
  [key: string]: unknown
}

export interface EventDateTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

export interface CalendarEvent {
  id: string
  iCalUID?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  start?: EventDateTime
  end?: EventDateTime
  recurrence?: string[]
  recurringEventId?: string
  originalStartTime?: EventDateTime
  created?: string
  updated?: string
  sequence?: number
  transparency?: string
  reminders?: { useDefault?: boolean; overrides?: { method: string; minutes: number }[] }
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> }
  [key: string]: unknown
}

/** ログインの有効期限切れ(再ログインが必要) */
export class AuthExpiredError extends Error {
  constructor() {
    super('ログインの有効期限が切れました。もう一度ログインしてください')
  }
}

async function apiGet<T>(token: AccessToken, path: string, params: Record<string, string> = {}): Promise<T> {
  if (Date.now() > token.expiresAt - 30_000) throw new AuthExpiredError()
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token.value}` } })
  if (res.status === 401) throw new AuthExpiredError()
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''
    } catch {
      /* 本文が JSON でない場合は無視 */
    }
    throw new Error(`Google API エラー ${res.status} ${detail}`.trim())
  }
  return res.json() as Promise<T>
}

async function getAllPages<T>(
  token: AccessToken,
  path: string,
  params: Record<string, string>,
  onPage?: (count: number) => void,
): Promise<{ items: T[]; firstPage: Record<string, unknown> }> {
  const items: T[] = []
  let firstPage: Record<string, unknown> | null = null
  let pageToken: string | undefined
  do {
    const page = await apiGet<{ items?: T[]; nextPageToken?: string } & Record<string, unknown>>(token, path, {
      ...params,
      ...(pageToken ? { pageToken } : {}),
    })
    firstPage ??= page
    items.push(...(page.items ?? []))
    onPage?.(items.length)
    pageToken = page.nextPageToken
  } while (pageToken)
  const { items: _i, nextPageToken: _n, ...meta } = firstPage as Record<string, unknown>
  return { items, firstPage: meta }
}

export function listCalendars(token: AccessToken) {
  return getAllPages<CalendarListEntry>(token, '/users/me/calendarList', { showHidden: 'true', maxResults: '250' })
}

/** 1つのカレンダーの全期間・全予定。繰り返しは展開せず元の形(親+例外)で取得し、削除済み例外も含める */
export function listAllEvents(token: AccessToken, calendarId: string, onPage?: (count: number) => void) {
  return getAllPages<CalendarEvent>(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { maxResults: '2500', showDeleted: 'true', singleEvents: 'false' },
    onPage,
  )
}

/** 表示用: 期間内の予定を、繰り返しを1回ずつに展開して取得 */
export async function listEventsInRange(token: AccessToken, calendarId: string, timeMin: Date, timeMax: Date) {
  const { items } = await getAllPages<CalendarEvent>(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
  })
  return items
}

/** 検索用: 全期間の予定(繰り返しは1回ずつに展開、未来は2年先まで)。
 * Google の q 検索は日本語の文字列の一部(例「15000円」の「15000」)に一致しないため、アプリ側で探す */
export async function listAllExpanded(token: AccessToken, calendarId: string) {
  const timeMax = new Date()
  timeMax.setFullYear(timeMax.getFullYear() + 2)
  const { items } = await getAllPages<CalendarEvent>(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMax: timeMax.toISOString(),
    maxResults: '2500',
  })
  return items
}

export function getEvent(token: AccessToken, calendarId: string, eventId: string) {
  return apiGet<CalendarEvent>(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`)
}

export function getSettings(token: AccessToken) {
  return getAllPages<Record<string, unknown>>(token, '/users/me/settings', {})
}

export function getColors(token: AccessToken) {
  return apiGet<Record<string, unknown>>(token, '/colors')
}
