// IndexedDB: キー・値ストア(フォルダの保存先ハンドルなど)と、予定の変更履歴
// 専用アプリの中では、IndexedDB の代わりにアプリ本体が暗号化して保存する
import { hostCall, inDesktopApp, reviveHost } from '../desktop/host'
const DB = 'webcalendar'
const KV = 'kv'
const JOURNAL = 'journal'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV)
      if (!db.objectStoreNames.contains(JOURNAL)) db.createObjectStore(JOURNAL, { autoIncrement: true })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  }).finally(() => db.close())
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  if (inDesktopApp) {
    try {
      const json = await hostCall<string | null>('kv.get', { key })
      return json == null ? undefined : (JSON.parse(json, reviveHost) as T)
    } catch {
      return undefined
    }
  }
  try {
    return await tx<T | undefined>(KV, 'readonly', (s) => s.get(key))
  } catch {
    return undefined
  }
}

export function idbSet(key: string, value: unknown): Promise<void> {
  if (inDesktopApp) return hostCall<void>('kv.set', { key, json: JSON.stringify(value) })
  return tx<void>(KV, 'readwrite', (s) => s.put(value, key)).then(() => undefined)
}

export function idbDelete(key: string): Promise<void> {
  if (inDesktopApp) return hostCall<void>('kv.delete', { key })
  return tx<void>(KV, 'readwrite', (s) => s.delete(key)).then(() => undefined)
}

export function journalAdd(entry: unknown): Promise<void> {
  if (inDesktopApp) return hostCall<void>('journal.add', { json: JSON.stringify(entry) })
  return tx<void>(JOURNAL, 'readwrite', (s) => s.add(entry)).then(() => undefined)
}

export async function journalAll<T>(): Promise<T[]> {
  if (inDesktopApp) return (await hostCall<string[]>('journal.all')).map((j) => JSON.parse(j) as T)
  return tx<T[]>(JOURNAL, 'readonly', (s) => s.getAll())
}
