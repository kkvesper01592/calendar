import type { AccessToken } from './auth'
import { hasScope } from './auth'
import { AuthExpiredError, getEvent, type CalendarEvent, type CalendarListEntry } from './calendarReadApi'
import { MARK_IMPORT, MARK_MEMO, MARK_TEST, SCOPE_APP_CREATED, SCOPE_EVENTS } from '../config'
import { recordChange, type JournalEntry } from '../backup/journal'

// 予定を書き換える処理はすべてこのファイルに集める。安全装置:
//  1) 書き込めるのは「アプリが作ったカレンダー」と「設定で編集を許可した既存カレンダー」だけ。ここで送信前に拒否する
//  2) Google 側でも権限の範囲外は拒否される(app.created はアプリ作成分のみ、events は予定の編集のみ)
//  3) 変更・削除の前に必ず変更前の予定を取得して変更履歴に残す(元に戻せるように)
//  4) 招待客などへの通知メールは送らない(sendUpdates=none)

const BASE = 'https://www.googleapis.com/calendar/v3'

export const isAppCalendar = (cal: CalendarListEntry) => {
  const d = typeof cal.description === 'string' ? cal.description : ''
  return d.includes(MARK_TEST) || d.includes(MARK_MEMO) || d.includes(MARK_IMPORT)
}
export const isMemoCalendar = (cal: CalendarListEntry) =>
  typeof cal.description === 'string' && cal.description.includes(MARK_MEMO)

// 設定画面で「編集を許可」した既存カレンダー
let editableIds = new Set<string>()
export const setEditableCalendars = (ids: string[]) => {
  editableIds = new Set(ids)
}

export const canWrite = (token: AccessToken | null) => !!token && (hasScope(token, SCOPE_APP_CREATED) || hasScope(token, SCOPE_EVENTS))
export const canEditExisting = (token: AccessToken | null) => !!token && hasScope(token, SCOPE_EVENTS)
/** 既存カレンダーのうち、編集を許可できるもの(自分が所有者か編集者) */
export const isEditableRole = (cal: CalendarListEntry) => cal.accessRole === 'owner' || cal.accessRole === 'writer'

/** このカレンダーに書き込めるか */
export function canWriteCalendar(token: AccessToken | null, cal: CalendarListEntry): boolean {
  if (!token) return false
  if (isAppCalendar(cal)) return hasScope(token, SCOPE_APP_CREATED) || hasScope(token, SCOPE_EVENTS)
  return hasScope(token, SCOPE_EVENTS) && editableIds.has(cal.id) && isEditableRole(cal)
}

function guard(token: AccessToken, cal: CalendarListEntry) {
  if (!canWriteCalendar(token, cal)) {
    throw new Error(`「${cal.summaryOverride || cal.summary}」は編集が許可されていません(設定画面の「既存カレンダーの編集」で許可できます)`)
  }
}

async function send<T>(token: AccessToken, method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T | null> {
  if (Date.now() > token.expiresAt - 30_000) throw new AuthExpiredError()
  // 予定の書き込みでは、招待客などへの通知メールを送らない
  const url = path.includes('/events') ? `${BASE}${path}${path.includes('?') ? '&' : '?'}sendUpdates=none` : BASE + path
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token.value}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) throw new AuthExpiredError()
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''
    } catch {
      /* 本文が JSON でない場合は無視 */
    }
    throw new Error(`Google への保存に失敗しました(${res.status} ${detail})`.trim())
  }
  return res.status === 204 ? null : ((await res.json()) as T)
}

const evPath = (calId: string, evId?: string) =>
  `/calendars/${encodeURIComponent(calId)}/events${evId ? `/${encodeURIComponent(evId)}` : ''}`

const calName = (cal: CalendarListEntry) => cal.summaryOverride || cal.summary
const now = () => new Date().toISOString()

/** アプリ専用のカレンダーを新しく作る(テスト用・メモ用) */
export async function createAppCalendar(token: AccessToken, summary: string, mark: string, timeZone: string) {
  if (!hasScope(token, SCOPE_APP_CREATED)) throw new Error('書き込みの権限がありません(ログイン時に許可されていません)')
  return send<CalendarListEntry>(token, 'POST', '/calendars', {
    summary,
    description: `WebCalendar が作成したカレンダーです。 ${mark}`,
    timeZone,
  })
}

export async function createEvent(token: AccessToken, cal: CalendarListEntry, body: Partial<CalendarEvent>) {
  guard(token, cal)
  const created = (await send<CalendarEvent>(token, 'POST', evPath(cal.id), body))!
  await recordChange({ at: now(), action: 'create', calendarId: cal.id, calendarName: calName(cal), eventId: created.id, before: null, after: created })
  return created
}

export async function updateEvent(token: AccessToken, cal: CalendarListEntry, eventId: string, patch: Partial<CalendarEvent>) {
  guard(token, cal)
  const before = await getEvent(token, cal.id, eventId) // 変更前を必ず残す
  const after = (await send<CalendarEvent>(token, 'PATCH', evPath(cal.id, eventId), patch))!
  await recordChange({ at: now(), action: 'update', calendarId: cal.id, calendarName: calName(cal), eventId, before, after })
  return after
}

export async function deleteEvent(token: AccessToken, cal: CalendarListEntry, eventId: string) {
  guard(token, cal)
  const before = await getEvent(token, cal.id, eventId) // 削除前を必ず残す
  await send(token, 'DELETE', evPath(cal.id, eventId))
  await recordChange({ at: now(), action: 'delete', calendarId: cal.id, calendarName: calName(cal), eventId, before, after: null })
}

/** 予定を別のカレンダーへ移す(予定の ID はそのまま)。移動元・移動先の両方に書き込める必要がある */
export async function moveEvent(token: AccessToken, from: CalendarListEntry, to: CalendarListEntry, eventId: string) {
  guard(token, from)
  guard(token, to)
  const before = await getEvent(token, from.id, eventId) // 移動前を必ず残す
  const after = (await send<CalendarEvent>(
    token,
    'POST',
    `${evPath(from.id, eventId)}/move?destination=${encodeURIComponent(to.id)}`,
  ))!
  await recordChange({
    at: now(),
    action: 'update',
    calendarId: to.id,
    calendarName: calName(to),
    eventId: after.id,
    before,
    after,
    movedFrom: { calendarId: from.id, calendarName: calName(from) },
  })
  return after
}

export const isImportCalendar = (cal: CalendarListEntry) =>
  typeof cal.description === 'string' && cal.description.includes(MARK_IMPORT)

/**
 * 取り込み専用カレンダーへの1件登録(大量登録用)。変更履歴には1件ずつ残さない
 * (取り込みは専用カレンダーにしか入らず、やり直しはカレンダーごと消せば済むため)。
 * Google から「送信が多すぎる」と言われたら、間を空けて最大5回までやり直す
 */
export async function insertImported(token: AccessToken, cal: CalendarListEntry, body: Partial<CalendarEvent>) {
  if (!isImportCalendar(cal)) throw new Error('取り込みは専用カレンダーにだけ行えます')
  guard(token, cal)
  for (let attempt = 0; ; attempt++) {
    try {
      return (await send<CalendarEvent>(token, 'POST', evPath(cal.id), body))!
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const retryable = /\((403|429|5\d\d)\b/.test(msg) && /(Rate|rate|limit|Limit|quota|Backend|5\d\d)/.test(msg)
      if (!retryable || attempt >= 5) throw e
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
  }
}

// 元に戻すときに書き戻す項目
const RESTORE_KEYS = ['summary', 'description', 'location', 'start', 'end', 'recurrence', 'reminders', 'colorId', 'extendedProperties', 'transparency'] as const

/** 変更履歴の1件を元に戻す(変更→変更前の内容に、移動→元のカレンダーへ、削除→復元、追加→削除) */
export async function undoChange(
  token: AccessToken,
  cal: CalendarListEntry,
  entry: JournalEntry,
  findCalendar: (id: string) => CalendarListEntry | undefined = () => undefined,
) {
  if (entry.action === 'create') return deleteEvent(token, cal, entry.eventId)

  if (entry.action === 'update' && entry.movedFrom) {
    const orig = findCalendar(entry.movedFrom.calendarId)
    if (!orig) throw new Error(`移動元のカレンダー「${entry.movedFrom.calendarName}」が見つかりません`)
    return moveEvent(token, cal, orig, entry.eventId)
  }

  if (entry.action === 'update') {
    const before = entry.before!
    const patch: Record<string, unknown> = {}
    for (const k of RESTORE_KEYS) {
      if (JSON.stringify(before[k]) !== JSON.stringify(entry.after?.[k])) patch[k] = before[k] ?? (k === 'recurrence' ? [] : null)
    }
    return updateEvent(token, cal, entry.eventId, patch as Partial<CalendarEvent>)
  }

  // 削除の取り消し: Google のごみ箱にある予定を元に戻す。戻せなければ同じ内容で作り直す
  guard(token, cal)
  const before = entry.before!
  try {
    const restored = (await send<CalendarEvent>(token, 'PATCH', evPath(cal.id, entry.eventId), { status: 'confirmed' }))!
    await recordChange({ at: now(), action: 'create', calendarId: cal.id, calendarName: calName(cal), eventId: restored.id, before: null, after: restored })
    return restored
  } catch {
    const copy: Record<string, unknown> = {}
    for (const k of RESTORE_KEYS) if (before[k] !== undefined) copy[k] = before[k]
    return createEvent(token, cal, copy as Partial<CalendarEvent>)
  }
}
