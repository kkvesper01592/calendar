import { useMemo, useRef, useState } from 'react'
import type { AccessToken } from '../google/auth'
import { listAllEvents, type CalendarEvent, type CalendarListEntry } from '../google/calendarReadApi'
import { createAppCalendar, deleteEvent, insertImported, isImportCalendar } from '../google/calendarWriteApi'
import { MARK_IMPORT } from '../config'
import { addDays, localIso, ymd } from '../lib/dates'
import { dateFromFileName, parseDay, SKIPPED_HEADINGS, SKIPPED_TITLES, type ImportItem } from './parseText'

interface Props {
  token: AccessToken
  calendars: CalendarListEntry[]
  onCalendarsChanged: () => void
  onDone: () => void
  onError: (e: unknown) => void
}

interface SourceFile {
  path: string
  text: string
}

// File System Access API のフォルダ読み取り(TS の DOM 型に未収録の部分)
type DirHandle = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }

async function readTextFiles(dir: DirHandle, prefix = ''): Promise<SourceFile[]> {
  const out: SourceFile[] = []
  for await (const [name, h] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (h.kind === 'directory') out.push(...(await readTextFiles(h as DirHandle, path)))
    else if (name.toLowerCase().endsWith('.txt')) out.push({ path, text: await (await (h as FileSystemFileHandle).getFile()).text() })
  }
  return out
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const toMinutes = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** 取り込む1件を Google に送る形にする(過去の予定なので通知は付けない) */
function toBody(it: ImportItem, step: number): Partial<CalendarEvent> {
  const [y, mo, d] = it.date.split('-').map(Number)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'
  const base: Partial<CalendarEvent> = {
    summary: it.title,
    location: it.location || undefined,
    description: it.description,
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { importKey: it.key, importSource: 'textmemo' } },
  }
  if (it.allDay) {
    const day = new Date(y, mo - 1, d)
    return { ...base, start: { date: ymd(day) }, end: { date: ymd(addDays(day, 1)) }, transparency: 'transparent' }
  }
  const s = new Date(y, mo - 1, d, Math.floor(it.startMinutes / 60), it.startMinutes % 60)
  return { ...base, start: { dateTime: localIso(s), timeZone: zone }, end: { dateTime: localIso(new Date(s.getTime() + step * 60000)), timeZone: zone } }
}

type Cleanup =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'found'; targets: { cal: CalendarListEntry; ev: CalendarEvent }[] }
  | { kind: 'deleting'; done: number; total: number; failed: number }
  | { kind: 'finished'; deleted: number; failed: number }

type Phase = { kind: 'idle' } | { kind: 'running'; done: number; total: number; skipped: number; failed: number } | { kind: 'finished'; created: number; skipped: number; failed: number; stopped: boolean }

/** 仕事メモのテキスト(1ファイル=1日)を、専用カレンダーへ取り込む */
export default function ImportPanel({ token, calendars, onCalendarsChanged, onDone, onError }: Props) {
  const [files, setFiles] = useState<SourceFile[] | null>(null)
  const [folderName, setFolderName] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [step, setStep] = useState(30)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [onlyWarn, setOnlyWarn] = useState(false)
  const [shown, setShown] = useState(100)
  const importCals = calendars.filter(isImportCalendar)
  const [target, setTarget] = useState<string>('')
  const [newName, setNewName] = useState('仕事メモ（2020〜2024）')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [failures, setFailures] = useState<string[]>([])
  const stopRef = useRef(false)
  const [reading, setReading] = useState(false)

  async function pickFolder() {
    try {
      const dir = (await window.showDirectoryPicker!({ id: 'import-text', mode: 'read' })) as DirHandle
      setReading(true)
      const list = await readTextFiles(dir)
      list.sort((a, b) => a.path.localeCompare(b.path))
      setFiles(list)
      setFolderName(dir.name)
      const dates = list.map((f) => dateFromFileName(f.path.split('/').pop() ?? '')).filter(Boolean).sort() as string[]
      if (dates.length) {
        // 最初は、いちばん古い1か月だけを試しに取り込む設定にしておく
        setFrom(dates[0].slice(0, 7))
        setTo(dates[0].slice(0, 7))
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') onError(e)
    } finally {
      setReading(false)
    }
  }

  const items = useMemo(() => {
    if (!files) return []
    const opt = { startMinutes: toMinutes(startTime), stepMinutes: step }
    return files.flatMap((f) => parseDay(f.path, f.text, opt))
  }, [files, startTime, step])

  const inRange = items.filter((it) => (!from || it.date.slice(0, 7) >= from) && (!to || it.date.slice(0, 7) <= to))
  const listed = onlyWarn ? inRange.filter((it) => it.warnings.length) : inRange
  const skippedFiles = files?.filter((f) => !dateFromFileName(f.path.split('/').pop() ?? '')).map((f) => f.path) ?? []
  const count = (arr: ImportItem[], k: ImportItem['timeSource']) => arr.filter((it) => it.timeSource === k).length

  async function run() {
    if (!inRange.length) return
    if (!window.confirm(`${inRange.length} 件の予定を取り込みます。よろしいですか?(同じものが既にある場合は飛ばします)`)) return
    stopRef.current = false
    setFailures([])
    try {
      // 取り込み先(無ければ専用カレンダーを作る)
      let cal = importCals.find((c) => c.id === target)
      if (!cal) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'
        cal = (await createAppCalendar(token, newName.trim() || '仕事メモ(取り込み)', MARK_IMPORT, tz))!
        setTarget(cal.id)
        onCalendarsChanged()
      }
      // 既に取り込んだもの(同じファイルの同じ件)は飛ばす
      const existing = new Set<string>()
      for (const ev of (await listAllEvents(token, cal.id)).items) {
        const k = ev.extendedProperties?.private?.importKey
        if (k && ev.status !== 'cancelled') existing.add(k)
      }
      const todo = inRange.filter((it) => !existing.has(it.key))
      let done = 0
      let failed = 0
      const skipped = inRange.length - todo.length
      setPhase({ kind: 'running', done, total: todo.length, skipped, failed })
      // 3件ずつ並行して送る
      let next = 0
      const worker = async () => {
        while (next < todo.length && !stopRef.current) {
          const it = todo[next++]
          try {
            await insertImported(token, cal!, toBody(it, step))
          } catch (e) {
            failed++
            setFailures((f) => [...f, `${it.date} ${it.title}: ${e instanceof Error ? e.message : String(e)}`])
            if (/ログインの有効期限/.test(String(e))) stopRef.current = true
          }
          done++
          setPhase({ kind: 'running', done, total: todo.length, skipped, failed })
        }
      }
      await Promise.all([worker(), worker(), worker()])
      setPhase({ kind: 'finished', created: done - failed, skipped, failed, stopped: stopRef.current })
      onDone()
    } catch (e) {
      setPhase({ kind: 'idle' })
      onError(e)
    }
  }

  // 以前の取り込みで入った、今は取り込まない見出し(【今後の予定】など)の終日予定を探して消す
  const [cleanup, setCleanup] = useState<Cleanup>({ kind: 'idle' })

  async function findSkipped() {
    setCleanup({ kind: 'searching' })
    try {
      const targets: { cal: CalendarListEntry; ev: CalendarEvent }[] = []
      for (const cal of importCals) {
        for (const ev of (await listAllEvents(token, cal.id)).items) {
          if (ev.status === 'cancelled') continue
          // 取り込みで作った・終日・タイトルが完全に一致するものだけ
          if (ev.extendedProperties?.private?.importSource !== 'textmemo' || !ev.start?.date) continue
          if (SKIPPED_TITLES.includes((ev.summary ?? '').trim())) targets.push({ cal, ev })
        }
      }
      targets.sort((a, b) => (a.ev.start?.date ?? '').localeCompare(b.ev.start?.date ?? ''))
      setCleanup({ kind: 'found', targets })
    } catch (e) {
      setCleanup({ kind: 'idle' })
      onError(e)
    }
  }

  async function deleteSkipped(targets: { cal: CalendarListEntry; ev: CalendarEvent }[]) {
    if (!window.confirm(`取り込み用カレンダーから ${targets.length} 件の「${SKIPPED_HEADINGS.join('・')}」を削除します。よろしいですか?\n(変更履歴から元に戻せます)`)) return
    let done = 0
    let failed = 0
    setCleanup({ kind: 'deleting', done, total: targets.length, failed })
    for (const { cal, ev } of targets) {
      try {
        await deleteEvent(token, cal, ev.id)
      } catch (e) {
        failed++
        if (/ログインの有効期限/.test(String(e))) {
          onError(e)
          break
        }
      }
      done++
      setCleanup({ kind: 'deleting', done, total: targets.length, failed })
    }
    setCleanup({ kind: 'finished', deleted: done - failed, failed })
    onDone()
  }

  const running = phase.kind === 'running'
  const cleaning = cleanup.kind === 'searching' || cleanup.kind === 'deleting'

  return (
    <section className="card import">
      <h2>テキストから取り込み(仕事メモ)</h2>
      <p className="hint">
        1ファイル=1日のテキスト(ファイル名が日付)を読み取り、区切りごとに1件の予定として<strong>取り込み専用のカレンダー</strong>に登録します。
        既存のカレンダーには書き込みません。読み取りはこのパソコンの中だけで行い、予定は Google にだけ送られます。
      </p>

      {importCals.length > 0 && (
        <div className="import-step">
          <h3>取り込み済みの「{SKIPPED_HEADINGS.join('・')}」を削除</h3>
          <p className="small-text">
            この見出しは多くの日に同じ内容が重複しているため、今は取り込まないようにしています。以前に取り込んだ分(終日の予定)を取り込み用カレンダーから探して削除します。
          </p>
          {(cleanup.kind === 'idle' || cleanup.kind === 'searching' || cleanup.kind === 'finished') && (
            <button className="small" onClick={findSkipped} disabled={running || cleaning}>
              {cleanup.kind === 'searching' ? '探しています…' : '探す'}
            </button>
          )}
          {cleanup.kind === 'found' &&
            (cleanup.targets.length === 0 ? (
              <p className="ok-text">見つかりませんでした(削除するものはありません)。</p>
            ) : (
              <>
                <p className="small-text">
                  {cleanup.targets.length} 件見つかりました({cleanup.targets[0].ev.start?.date} 〜 {cleanup.targets[cleanup.targets.length - 1].ev.start?.date})。
                </p>
                <div className="import-actions">
                  <button onClick={() => deleteSkipped(cleanup.targets)} disabled={running}>{cleanup.targets.length} 件を削除</button>
                  <button className="small ghost" onClick={() => setCleanup({ kind: 'idle' })}>やめる</button>
                </div>
              </>
            ))}
          {cleanup.kind === 'deleting' && (
            <div className="progress">
              <progress max={cleanup.total || 1} value={cleanup.done} />
              <span className="small-text">{cleanup.done} / {cleanup.total} 件(失敗 {cleanup.failed} 件)</span>
            </div>
          )}
          {cleanup.kind === 'finished' && (
            <p className={cleanup.failed ? 'warn' : 'ok-text'}>
              削除 {cleanup.deleted} 件、失敗 {cleanup.failed} 件。{cleanup.failed ? 'もう一度「探す」から削除すると、残りを消せます。' : ''}
            </p>
          )}
        </div>
      )}

      <div className="import-step">
        <h3>1. フォルダを選ぶ</h3>
        <button onClick={pickFolder} disabled={running || reading}>{reading ? '読み込み中…' : files ? 'フォルダを選び直す' : 'フォルダを選ぶ'}</button>
        {files && (
          <p className="small-text">
            「{folderName}」: テキスト {files.length} ファイル → 予定 {items.length} 件(時刻が書かれていた {count(items, 'text')} 件、30分刻みで自動{' '}
            {count(items, 'auto')} 件、終日のメモ {count(items, 'allDay')} 件)
            {skippedFiles.length > 0 && <>。日付でないため取り込まないファイル: {skippedFiles.join('、')}</>}
          </p>
        )}
      </div>

      {files && (
        <>
          <div className="import-step">
            <h3>2. 読み取りの設定と確認</h3>
            <div className="import-opts">
              <label>
                1件目の開始時刻 <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value || '09:00')} disabled={running} />
              </label>
              <label>
                間隔 <input type="number" min={5} step={5} className="num" value={step} onChange={(e) => setStep(Math.max(5, Number(e.target.value) || 30))} disabled={running} /> 分
              </label>
              <label>
                期間 <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} disabled={running} /> 〜{' '}
                <input type="month" value={to} onChange={(e) => setTo(e.target.value)} disabled={running} />
              </label>
              <button className="small ghost" onClick={() => (setFrom(''), setTo(''))} disabled={running}>全期間</button>
              <label className="check">
                <input type="checkbox" checked={onlyWarn} onChange={(e) => setOnlyWarn(e.target.checked)} /> 注意のあるものだけ表示
              </label>
            </div>
            <p className="small-text">
              この期間: {inRange.length} 件(時刻あり {count(inRange, 'text')} / 自動 {count(inRange, 'auto')} / 終日のメモ {count(inRange, 'allDay')})。
              時刻が書かれた予定はその時刻から、無い予定は前の予定の{step}分後から並べます。
            </p>
            <div className="table-wrap">
              <table className="import-table">
                <thead>
                  <tr><th>日付</th><th>時刻</th><th>タイトル</th><th>場所</th><th>メモ(先頭)</th><th>注意</th></tr>
                </thead>
                <tbody>
                  {listed.slice(0, shown).map((it) => (
                    <tr key={it.key} className={it.warnings.length ? 'warn-row' : ''}>
                      <td className="nowrap">{it.date}</td>
                      <td className="nowrap">
                        {it.allDay ? '終日' : hhmm(it.startMinutes)}
                        {it.timeSource === 'text' && <span className="tag" title={`「${it.timeText}」から`}>記載</span>}
                      </td>
                      <td>{it.title}</td>
                      <td>{it.location}</td>
                      <td className="memo-cell">{it.description.split('\n').slice(0, 3).join(' / ')}</td>
                      <td className="small-text">{it.warnings.join('、')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {listed.length > shown && (
              <button className="small ghost" onClick={() => setShown(shown + 200)}>さらに表示({listed.length - shown} 件)</button>
            )}
          </div>

          <div className="import-step">
            <h3>3. 取り込む</h3>
            <label className="field">
              <span>取り込み先</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={running}>
                <option value="">新しい専用カレンダーを作る</option>
                {importCals.map((c) => (
                  <option key={c.id} value={c.id}>{c.summaryOverride || c.summary}</option>
                ))}
              </select>
            </label>
            {!target && (
              <label className="field">
                <span>新しいカレンダーの名前</span>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} disabled={running} />
              </label>
            )}
            <div className="import-actions">
              <button onClick={run} disabled={running || !inRange.length}>
                {inRange.length} 件を取り込む
              </button>
              {running && <button className="small ghost" onClick={() => (stopRef.current = true)}>途中で止める</button>}
            </div>
            {phase.kind === 'running' && (
              <div className="progress">
                <progress max={phase.total || 1} value={phase.done} />
                <span className="small-text">
                  {phase.done} / {phase.total} 件(既にあるので飛ばした {phase.skipped} 件、失敗 {phase.failed} 件)
                </span>
              </div>
            )}
            {phase.kind === 'finished' && (
              <p className={phase.failed ? 'warn' : 'ok-text'}>
                {phase.stopped ? '途中で止めました。' : '取り込みが終わりました。'}登録 {phase.created} 件、既にあったので飛ばした {phase.skipped} 件、失敗{' '}
                {phase.failed} 件。{phase.stopped || phase.failed ? 'もう一度「取り込む」を押すと、残りだけを登録します。' : ''}
              </p>
            )}
            {failures.length > 0 && (
              <details>
                <summary className="small-text">失敗した予定({failures.length})</summary>
                <ul className="small-text">{failures.slice(0, 50).map((f, i) => <li key={i}>{f}</li>)}</ul>
              </details>
            )}
            <p className="hint small-text">
              取り込みをやり直したいときは、Google カレンダーの設定でこの専用カレンダーごと削除すれば、取り込んだ予定だけがすべて消えます(既存のカレンダーには影響しません)。
            </p>
          </div>
        </>
      )}
    </section>
  )
}
