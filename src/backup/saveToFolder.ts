import type { FullBackup } from './collect'
import { toIcs } from './ics'
import { toViewerHtml } from './viewer'

// File System Access API(Edge / Chrome)。TS の DOM 型に未収録の部分だけ補う
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>
  }
}

export const canPickFolder = () => typeof window.showDirectoryPicker === 'function'

export function pickFolder(): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker!({ id: 'calendar-backup', mode: 'readwrite', startIn: 'documents' })
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+$/, '').slice(0, 80) || 'calendar'
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, content: string) {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(content)
  await w.close()
  // 書けたことを読み戻して確認
  const size = (await fh.getFile()).size
  const expected = new TextEncoder().encode(content).length
  if (size !== expected) throw new Error(`${name} の保存サイズが一致しません(${size} / ${expected})`)
}

export interface SavedResult {
  folderName: string
  files: string[]
}

/** 選んだフォルダの中に backup_日時 フォルダを作り、JSON・カレンダー別 .ics・閲覧用 HTML を保存する */
export async function saveBackup(root: FileSystemDirectoryHandle, b: FullBackup): Promise<SavedResult> {
  const folderName = `backup_${stamp(new Date(b.createdAt))}`
  const dir = await root.getDirectoryHandle(folderName, { create: true })
  const files: string[] = []

  await writeFile(dir, 'full_backup.json', JSON.stringify(b, null, 2))
  files.push('full_backup.json')

  await writeFile(dir, '予定一覧.html', toViewerHtml(b))
  files.push('予定一覧.html')

  const icsDir = await dir.getDirectoryHandle('ics', { create: true })
  const used = new Set<string>()
  for (const c of b.calendars) {
    if (c.error) continue
    let name = safeName(c.calendar.summaryOverride || c.calendar.summary)
    for (let i = 2; used.has(name); i++) name = `${safeName(c.calendar.summaryOverride || c.calendar.summary)}_${i}`
    used.add(name)
    await writeFile(icsDir, `${name}.ics`, toIcs(c))
    files.push(`ics/${name}.ics`)
  }
  return { folderName, files }
}

/** フォルダ選択に対応していないブラウザ向け: JSON だけダウンロード */
export function downloadJson(b: FullBackup) {
  const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `full_backup_${stamp(new Date(b.createdAt))}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
