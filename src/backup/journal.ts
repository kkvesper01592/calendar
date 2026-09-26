import { journalAdd, journalAll } from '../lib/idb'
import { getAutoDir, permission } from './autoBackup'
import type { CalendarEvent } from '../google/calendarReadApi'

/** 予定の変更1回分。変更前(before)を必ず残し、あとから元に戻せるようにする */
export interface JournalEntry {
  at: string
  action: 'create' | 'update' | 'delete'
  calendarId: string
  calendarName: string
  eventId: string
  before: CalendarEvent | null
  after: CalendarEvent | null
}

/** 変更履歴を端末(IndexedDB)に保存し、PC で保存先フォルダの許可があれば「変更履歴」フォルダにも追記する */
export async function recordChange(entry: JournalEntry): Promise<void> {
  await journalAdd(entry)
  try {
    const dir = await getAutoDir()
    if (!dir || (await permission(dir)) !== 'granted') return
    const logDir = await dir.getDirectoryHandle('変更履歴', { create: true })
    const name = `${entry.at.slice(0, 7)}.jsonl` // 月ごとに1ファイル
    const fh = await logDir.getFileHandle(name, { create: true })
    const size = (await fh.getFile()).size
    const w = await fh.createWritable({ keepExistingData: true })
    await w.seek(size)
    await w.write(JSON.stringify(entry) + '\n')
    await w.close()
  } catch {
    /* フォルダに書けなくても端末内の履歴には残っている */
  }
}

export async function recentChanges(limit = 100): Promise<JournalEntry[]> {
  try {
    return (await journalAll<JournalEntry>()).slice(-limit).reverse()
  } catch {
    return []
  }
}
