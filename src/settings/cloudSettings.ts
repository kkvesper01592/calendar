// 設定を Google にも保存し、ブラウザのデータが消えても戻せるようにする。
// 保存先: アプリが作る「WebCalendar 設定」カレンダーの予定1件(2000-01-01)の非公開の項目(画面には出ない)。
// ・PC とスマホで共通の設定(shared): 見た目・週・休日・日付の背景色・テンプレート
// ・端末の種類ごとの設定(devices.pc / devices.mobile): 既存カレンダーの編集の許可
//   (スマホは「許可しない限り閲覧のみ」の方針を守るため、PC の許可をスマホに広げない)
// ・その端末だけの設定(文字の大きさ・週表示の日数・オフライン表示など)は保存しない
import type { AccessToken } from '../google/auth'
import { listAllEvents, type CalendarEvent, type CalendarListEntry } from '../google/calendarReadApi'
import { createAppCalendar, isSettingsCalendar, writeSettingsEvent } from '../google/calendarWriteApi'
import { MARK_SETTINGS } from '../config'
import type { Prefs } from './prefs'
import type { Template } from '../editing/templates'

export type SharedPrefs = Pick<Prefs, 'theme' | 'accent' | 'bold' | 'weekStart' | 'holidayWeekdays' | 'dayColors'>
export const SHARED_KEYS: (keyof SharedPrefs)[] = ['theme', 'accent', 'bold', 'weekStart', 'holidayWeekdays', 'dayColors']

export interface SharedPart {
  updatedAt: string
  prefs: SharedPrefs
  templates: Template[]
}
export interface DevicePart {
  updatedAt: string
  editableCalendars: string[]
  backupFolderName?: string // PC のバックアップの保存先フォルダの名前(選び直すときの目安)
}
export interface CloudSettings {
  v: 1
  shared?: SharedPart
  devices: { pc?: DevicePart; mobile?: DevicePart }
}

export type DeviceKind = 'pc' | 'mobile'

const MARK_PROP = 'webcalendarSettings'
const CHUNK = 250 // 1項目あたりの文字数(Google の上限 1024 バイトに収まるように)
const MAX_BYTES = 30_000 // 予定1件の非公開の項目の合計の上限(約32KB)に余裕をみる

// 端末側の「最後に変えた/合わせた日時」(Google の方が新しければ Google の内容に戻す)
const LOCAL_SHARED_AT = 'webcalendar.sharedSettingsAt'
const LOCAL_DEVICE_AT = 'webcalendar.deviceSettingsAt'
const readLocal = (k: string) => {
  try {
    return localStorage.getItem(k) ?? ''
  } catch {
    return ''
  }
}
const writeLocal = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* 保存できない環境 */
  }
}
// Google に保存してあった、PC のバックアップの保存先フォルダの名前(選び直すときに知らせる)
let rememberedFolder = ''
export const setRememberedFolder = (name: string | undefined) => {
  rememberedFolder = name ?? ''
}
export const getRememberedFolder = () => rememberedFolder

export const localSharedAt = () => readLocal(LOCAL_SHARED_AT)
export const localDeviceAt = () => readLocal(LOCAL_DEVICE_AT)
export const setLocalSharedAt = (v: string) => writeLocal(LOCAL_SHARED_AT, v)
export const setLocalDeviceAt = (v: string) => writeLocal(LOCAL_DEVICE_AT, v)

export function pickShared(p: Prefs): SharedPrefs {
  const out = {} as Record<string, unknown>
  for (const k of SHARED_KEYS) out[k] = p[k]
  return out as SharedPrefs
}

function encode(data: CloudSettings): Record<string, string> {
  const json = JSON.stringify(data)
  if (new TextEncoder().encode(json).length > MAX_BYTES) {
    throw new Error('設定が大きすぎて Google に保存できません(テンプレートのメモを短くしてください)')
  }
  const props: Record<string, string> = { [MARK_PROP]: '1' }
  const n = Math.ceil(json.length / CHUNK)
  for (let i = 0; i < n; i++) props[`c${i}`] = json.slice(i * CHUNK, (i + 1) * CHUNK)
  props.n = String(n)
  return props
}

function decode(ev: CalendarEvent): CloudSettings | null {
  const p = ev.extendedProperties?.private
  const n = Number(p?.n)
  if (!p || !n) return null
  let json = ''
  for (let i = 0; i < n; i++) json += p[`c${i}`] ?? ''
  try {
    const data = JSON.parse(json) as CloudSettings
    return data.v === 1 ? { ...data, devices: data.devices ?? {} } : null
  } catch {
    return null
  }
}

async function findEvent(token: AccessToken, cal: CalendarListEntry) {
  const { items } = await listAllEvents(token, cal.id)
  return items.find((e) => e.status !== 'cancelled' && e.extendedProperties?.private?.[MARK_PROP] === '1')
}

/** Google に保存した設定を読む(まだ無ければ null) */
export async function loadCloudSettings(token: AccessToken, calendars: CalendarListEntry[]): Promise<CloudSettings | null> {
  const cal = calendars.find(isSettingsCalendar)
  if (!cal) return null
  const ev = await findEvent(token, cal)
  return ev ? decode(ev) : null
}

/**
 * Google に保存する。ほかの端末の分を消さないよう、最新を読んでから自分の分だけ差し替える。
 * 設定用のカレンダーが無ければ作る(作ったら true を返すので、呼び出し側でカレンダー一覧を読み直す)
 */
export async function saveCloudSettings(
  token: AccessToken,
  calendars: CalendarListEntry[],
  update: (cur: CloudSettings) => CloudSettings,
): Promise<{ createdCalendar: boolean }> {
  let cal = calendars.find(isSettingsCalendar)
  let createdCalendar = false
  if (!cal) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'
    cal = (await createAppCalendar(token, 'WebCalendar 設定', MARK_SETTINGS, tz))!
    createdCalendar = true
  }
  const ev = createdCalendar ? undefined : await findEvent(token, cal)
  const cur = (ev && decode(ev)) || { v: 1, devices: {} }
  const next = update(cur)
  const body: Partial<CalendarEvent> = {
    extendedProperties: { private: encode(next) },
    ...(ev
      ? {}
      : {
          summary: 'WebCalendar の設定(消さないでください)',
          description: 'WebCalendar アプリの設定(見た目・テンプレート・既存カレンダーの編集の許可など)を保存しています。この予定と「WebCalendar 設定」カレンダーは削除しないでください。',
          start: { date: '2000-01-01' },
          end: { date: '2000-01-02' },
          transparency: 'transparent',
          reminders: { useDefault: false, overrides: [] },
        }),
  }
  await writeSettingsEvent(token, cal, ev?.id, body)
  return { createdCalendar }
}
