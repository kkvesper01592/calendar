import type { AccessToken } from '../google/auth'
import { idbGet, idbSet } from '../lib/idb'
import { ymd } from '../lib/dates'
import { collectFullBackup } from './collect'
import { saveBackup, type SavedResult } from './saveToFolder'

// File System Access API の権限まわり(TS の DOM 型に未収録)
type PermState = 'granted' | 'denied' | 'prompt'
interface PermissionHandle {
  queryPermission(opts: { mode: 'readwrite' }): Promise<PermState>
  requestPermission(opts: { mode: 'readwrite' }): Promise<PermState>
}

const DIR_KEY = 'autoBackupDir'
const LAST_KEY = 'webcalendar.lastAutoBackup'

export const getAutoDir = () => idbGet<FileSystemDirectoryHandle>(DIR_KEY)
export const setAutoDir = (h: FileSystemDirectoryHandle) => idbSet(DIR_KEY, h)

export function permission(h: FileSystemDirectoryHandle): Promise<PermState> {
  return (h as unknown as PermissionHandle).queryPermission({ mode: 'readwrite' })
}

/** ボタン操作の中から呼ぶ(ブラウザの許可ダイアログが出る) */
export async function requestPermission(h: FileSystemDirectoryHandle): Promise<boolean> {
  return (await (h as unknown as PermissionHandle).requestPermission({ mode: 'readwrite' })) === 'granted'
}

export interface LastBackup {
  day: string
  at: string
  folderName: string
  events: number
}

export function lastAutoBackup(): LastBackup | null {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null')
  } catch {
    return null
  }
}

export const isDueToday = () => lastAutoBackup()?.day !== ymd(new Date())

/** 全カレンダーを読み取り、保存先フォルダに backup_日時 として書き出す */
export async function runBackupTo(
  dir: FileSystemDirectoryHandle,
  token: AccessToken,
  log: (m: string) => void = () => {},
): Promise<SavedResult & { events: number }> {
  const b = await collectFullBackup(token, log)
  const saved = await saveBackup(dir, b)
  const events = b.calendars.reduce((n, c) => n + c.events.filter((e) => e.status !== 'cancelled').length, 0)
  const rec: LastBackup = { day: ymd(new Date()), at: new Date().toISOString(), folderName: saved.folderName, events }
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(rec))
  } catch {
    /* 記録できなくてもバックアップ自体は成功している */
  }
  return { ...saved, events }
}
