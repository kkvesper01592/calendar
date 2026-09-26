import { useRef, useState } from 'react'
import type { AccessToken } from '../google/auth'
import { getEvent, type CalendarEvent, type CalendarListEntry } from '../google/calendarReadApi'
import { canWrite, canWriteCalendar, createAppCalendar, createEvent, deleteEvent, isAppCalendar, isMemoCalendar, moveEvent, undoChange, updateEvent } from '../google/calendarWriteApi'
import { getAutoDir, isDueToday, permission, requestPermission, runBackupTo, setAutoDir } from '../backup/autoBackup'
import { canPickFolder, pickFolder } from '../backup/saveToFolder'
import type { JournalEntry } from '../backup/journal'
import { MARK_MEMO, MARK_TEST } from '../config'
import type { Colors, DisplayEvent } from '../calendar/useRangeEvents'
import { addDays, ymd } from '../lib/dates'
import EventEditor, { type EditorTarget } from './EventEditor'
import MemoEditor from './MemoEditor'
import ConfirmDialog, { type Choice } from './ConfirmDialog'
import QuickAdd from './QuickAdd'
import { loadTemplates, loadTimeMode, saveTemplates, saveTimeMode, templateFromEvent, templateToEvent, type Template, type TemplateTimeMode } from './templates'

interface Options {
  token: AccessToken | null
  calendars: CalendarListEntry[]
  colors: Colors | null
  onChanged: () => void // Google 側が変わったので再読み込み
  onCalendarsChanged: () => void
  onError: (e: unknown) => void
  onNotice: (msg: string) => void
  suggestStart: (date: Date) => Date | undefined // 新しい予定の開始時刻の候補(その日の最後の予定の終了時刻)
  searchPast?: (query: string) => Promise<DisplayEvent[]> // 追加画面の「予定の検索」
}

type Confirm = { title: string; message?: string; choices: Choice[] }

/** 予定の追加・編集・削除と日付メモの画面の流れをまとめる */
export function useEditing({ token, calendars, colors, onChanged, onCalendarsChanged, onError, onNotice, suggestStart, searchPast }: Options) {
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [memo, setMemo] = useState<{ date: Date; existing?: DisplayEvent } | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [templates, setTemplatesState] = useState<Template[]>(loadTemplates)
  const [quick, setQuick] = useState<Date | null>(null)
  const [stamp, setStamp] = useState<{ template: Template; count: number; mode: TemplateTimeMode } | null>(null)
  const [timeMode, setTimeModeState] = useState<TemplateTimeMode>(loadTimeMode)
  const setTimeMode = (m: TemplateTimeMode) => {
    setTimeModeState(m)
    saveTimeMode(m)
  }
  // 「最後の予定の後」のときの開始時刻(終日のひな形や、その日に予定が無いときは undefined = ひな形の時刻)
  const templateStart = (t: Template, date: Date, mode: TemplateTimeMode) => (mode === 'after' && !t.allDay ? suggestStart(date) : undefined)

  const setTemplates = (list: Template[]) => {
    setTemplatesState(list)
    saveTemplates(list)
  }

  const writable = canWrite(token)
  // 書き込める(予定用の)カレンダー: アプリ作成のテスト用 + 設定で編集を許可した既存カレンダー
  const eventCalendars = calendars.filter((c) => canWriteCalendar(token, c) && !isMemoCalendar(c))
  const memoCalendar = writable ? calendars.find(isMemoCalendar) : undefined
  const hasTestCalendar = calendars.some((c) => isAppCalendar(c) && !isMemoCalendar(c))
  const hasMemoCalendar = calendars.some(isMemoCalendar)

  const isMemo = (e: DisplayEvent) => isMemoCalendar(e.calendar)
  const canEdit = (e: DisplayEvent) => canWriteCalendar(token, e.calendar)

  // ---- 既存カレンダーへの書き込み前の、その日の全体バックアップ(PC) ----
  // 「予定を追加」「編集」などを押した時点で裏で始め、保存するときに終わっていなければ待つ。
  const backupRun = useRef<Promise<void> | null>(null)
  const needsBackup = () => !!token && canPickFolder() && isDueToday() && eventCalendars.some((c) => !isAppCalendar(c))

  function startBackup(dir: FileSystemDirectoryHandle): Promise<void> {
    backupRun.current ??= (async () => {
      onNotice('今日のバックアップを保存しています…(そのまま入力を続けられます)')
      await runBackupTo(dir, token!)
      onNotice('今日のバックアップを保存しました')
    })().finally(() => {
      backupRun.current = null
    })
    return backupRun.current
  }

  /** ボタンを押した時点で呼ぶ: 保存先が決まっていれば裏でバックアップを始める(許可を求められたら「許可」を押すだけ) */
  function prefetchBackup() {
    if (!needsBackup() || backupRun.current) return
    ;(async () => {
      const dir = await getAutoDir()
      if (!dir) return // 保存先がまだ無ければ、保存するときに選んでもらう
      if ((await permission(dir)) !== 'granted' && !(await requestPermission(dir))) return
      await startBackup(dir)
    })().catch(() => {
      /* ここで失敗しても、保存するときにもう一度試す */
    })
  }

  /** 既存カレンダーへ書き込む直前に呼ぶ: 今日のバックアップが済むまで待つ(入力内容は消えない) */
  async function ensureBackup(cal: CalendarListEntry) {
    if (isAppCalendar(cal) || !canPickFolder() || !isDueToday()) return
    if (backupRun.current) {
      await backupRun.current.catch(() => {})
      if (!isDueToday()) return
    }
    let dir = await getAutoDir()
    if (!dir) {
      try {
        dir = await pickFolder()
      } catch {
        throw new Error('バックアップの保存先フォルダが選ばれなかったため、保存を中止しました。入力内容はそのまま残っています。もう一度「保存」を押してください')
      }
      await setAutoDir(dir)
    }
    if ((await permission(dir)) !== 'granted' && !(await requestPermission(dir))) {
      throw new Error('バックアップの保存先フォルダへの書き込みが許可されませんでした。入力内容はそのまま残っています。もう一度「保存」を押して「許可」を選んでください')
    }
    await startBackup(dir)
  }

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      onChanged()
    } catch (e) {
      onError(e)
    }
  }

  /** hour を指定しない追加は、その日の最後の予定が終わる時刻から始める */
  function startCreate(date: Date, hour?: number) {
    if (!eventCalendars.length) return
    prefetchBackup()
    setEditor({ mode: 'create', date, hour, start: hour === undefined ? suggestStart(date) : undefined })
  }

  /** 繰り返しの予定は「この回だけ」か「すべて」かを選んでから編集する */
  function startEdit(item: DisplayEvent) {
    if (!token) return
    if (!isAppCalendar(item.calendar)) prefetchBackup()
    if (isMemo(item)) return setMemo({ date: new Date(`${item.ev.start?.date ?? ymd(new Date())}T00:00`), existing: item })
    const masterId = item.ev.recurringEventId
    if (!masterId) return setEditor({ mode: 'edit', calendar: item.calendar, event: item.ev, instance: false })
    setConfirm({
      title: '繰り返しの予定の編集',
      message: 'どの範囲を編集しますか?',
      choices: [
        { label: 'この予定のみ', action: () => (setConfirm(null), setEditor({ mode: 'edit', calendar: item.calendar, event: item.ev, instance: true })) },
        {
          label: 'すべての繰り返し',
          action: () => {
            setConfirm(null)
            getEvent(token, item.calendar.id, masterId)
              .then((master) => setEditor({ mode: 'edit', calendar: item.calendar, event: master, instance: false }))
              .catch(onError)
          },
        },
      ],
    })
  }

  function startDelete(item: DisplayEvent, after?: () => void) {
    if (!token) return
    if (!isAppCalendar(item.calendar)) prefetchBackup()
    const title = item.ev.summary || '(タイトルなし)'
    const del = (id: string) => () => {
      setConfirm(null)
      after?.()
      run(async () => {
        await ensureBackup(item.calendar)
        await deleteEvent(token, item.calendar, id)
      })
    }
    const masterId = item.ev.recurringEventId
    setConfirm(
      masterId
        ? {
            title: '繰り返しの予定の削除',
            message: `「${title}」のどの範囲を削除しますか?(削除前の内容は変更履歴に残ります)`,
            choices: [
              { label: 'この予定のみ削除', danger: true, action: del(item.ev.id) },
              { label: 'すべての繰り返しを削除', danger: true, action: del(masterId) },
            ],
          }
        : {
            title: '予定の削除',
            message: `「${title}」を削除しますか?(削除前の内容は変更履歴に残ります)`,
            choices: [{ label: '削除する', danger: true, action: del(item.ev.id) }],
          },
    )
  }

  /** 変更履歴の1件を元に戻す(確認してから) */
  function undo(entry: JournalEntry, after?: () => void) {
    if (!token) return
    prefetchBackup()
    const cal = calendars.find((c) => c.id === entry.calendarId)
    if (!cal) return onError(new Error(`カレンダー「${entry.calendarName}」が見つかりません`))
    const title = (entry.before ?? entry.after)?.summary || '(タイトルなし)'
    const what = { create: '追加した予定を削除', update: '変更前の内容に戻', delete: '削除した予定を復元' }[entry.action]
    setConfirm({
      title: '元に戻す',
      message: `「${title}」(${entry.calendarName})を${what}します。この変更の後にさらに変更していた場合、その変更も上書きされます。`,
      choices: [
        {
          label: '元に戻す',
          danger: entry.action === 'create',
          action: () => {
            setConfirm(null)
            run(async () => {
              await ensureBackup(cal)
              await undoChange(token, cal, entry, (id) => calendars.find((c) => c.id === id))
              onNotice(`「${title}」を元に戻しました`)
              after?.()
            })
          },
        },
      ],
    })
  }

  function startMemo(date: Date, existing?: DisplayEvent) {
    if (memoCalendar) setMemo({ date, existing })
  }

  async function saveMemo(text: string) {
    if (!token || !memoCalendar || !memo) return
    const firstLine = text.trim().split('\n')[0].slice(0, 40) || 'メモ'
    const body: Partial<CalendarEvent> = { summary: firstLine, description: text }
    if (memo.existing) await updateEvent(token, memoCalendar, memo.existing.ev.id, body)
    else
      await createEvent(token, memoCalendar, {
        ...body,
        start: { date: ymd(memo.date) },
        end: { date: ymd(addDays(memo.date, 1)) },
        transparency: 'transparent',
        reminders: { useDefault: false, overrides: [] },
      })
    setMemo(null)
    onChanged()
  }

  function saveAsTemplate(item: DisplayEvent) {
    const t = templateFromEvent(item.ev, isAppCalendar(item.calendar) ? item.calendar.id : undefined)
    // 同じ名前・同じ時間帯のテンプレートがあれば、増やさずに内容を更新する
    const same = templates.find((x) => x.title === t.title && x.allDay === t.allDay && x.startTime === t.startTime && x.minutes === t.minutes)
    if (same) {
      setTemplates(templates.map((x) => (x.id === same.id ? { ...t, id: same.id } : x)))
      onNotice(`テンプレート「${t.title || '(タイトルなし)'}」を更新しました`)
    } else {
      setTemplates([...templates, t])
      onNotice(`「${t.title || '(タイトルなし)'}」をテンプレートに保存しました`)
    }
  }

  function startQuickAdd(date: Date) {
    prefetchBackup()
    if (eventCalendars.length) setQuick(date)
  }

  /** ひな形からその日に登録。保存先はひな形のカレンダー(書き込めなければ最初の書き込めるカレンダー) */
  async function addFromTemplate(t: Template, date: Date, mode: TemplateTimeMode) {
    if (!token) return
    const cal = eventCalendars.find((c) => c.id === t.calendarId) ?? eventCalendars[0]
    if (!cal) return
    await ensureBackup(cal)
    await createEvent(token, cal, templateToEvent(t, date, templateStart(t, date, mode)))
    onChanged()
  }

  async function pickTemplate(t: Template, keepStamping: boolean) {
    const date = quick
    setQuick(null)
    if (!date) return
    // 通常はテンプレートの内容を入れた編集画面を開く。スタンプモードだけ直接登録して続ける
    if (!keepStamping) return setEditor({ mode: 'create', date, template: t, start: templateStart(t, date, timeMode) })
    try {
      await addFromTemplate(t, date, timeMode)
      setStamp({ template: t, count: 1, mode: timeMode })
    } catch (e) {
      onError(e)
    }
  }

  /** スタンプモード中に日付を押したとき */
  async function stampDay(date: Date) {
    if (!stamp) return
    try {
      await addFromTemplate(stamp.template, date, stamp.mode)
      setStamp((s) => (s ? { ...s, count: s.count + 1 } : s))
    } catch (e) {
      onError(e)
    }
  }

  async function createCalendar(kind: 'test' | 'memo') {
    if (!token) return
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'
    try {
      await createAppCalendar(token, kind === 'test' ? 'WebCalendar テスト' : 'メモ', kind === 'test' ? MARK_TEST : MARK_MEMO, tz)
      onCalendarsChanged()
    } catch (e) {
      onError(e)
    }
  }

  const dialogs = (
    <>
      {editor && (
        <EventEditor
          target={editor}
          calendars={eventCalendars}
          colors={colors}
          templates={templates}
          timeMode={timeMode}
          onTimeMode={setTimeMode}
          suggestStart={suggestStart}
          searchPast={searchPast}
          onCancel={() => setEditor(null)}
          onSave={async (cal, body, eventId) => {
            if (!token) return
            // 編集中にカレンダーを変えたときは、内容の変更を元のカレンダーで保存してから移動する
            const orig = editor.mode === 'edit' ? editor.calendar : undefined
            const moving = !!orig && orig.id !== cal.id
            await ensureBackup(cal)
            if (moving) await ensureBackup(orig!)
            if (eventId) {
              if (Object.keys(body).length) await updateEvent(token, orig ?? cal, eventId, body)
              if (moving) await moveEvent(token, orig!, cal, eventId)
            } else await createEvent(token, cal, body)
            setEditor(null)
            onChanged()
          }}
        />
      )}
      {memo && (
        <MemoEditor
          date={memo.date}
          initial={memo.existing ? memo.existing.ev.description || memo.existing.ev.summary || '' : ''}
          exists={!!memo.existing}
          onCancel={() => setMemo(null)}
          onSave={saveMemo}
          onDelete={() => {
            const ex = memo.existing
            if (!ex) return
            setMemo(null)
            startDelete(ex)
          }}
        />
      )}
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
      {quick && (
        <QuickAdd
          date={quick}
          templates={templates}
          onPick={pickTemplate}
          timeMode={timeMode}
          onTimeMode={setTimeMode}
          afterTime={suggestStart(quick)}
          onCancel={() => setQuick(null)}
          toPreview={(t) => {
            const cal = eventCalendars.find((c) => c.id === t.calendarId) ?? eventCalendars[0]
            const ev = { ...templateToEvent(t, quick, templateStart(t, quick, timeMode)), id: t.id } as CalendarEvent
            const color = (t.colorId && colors?.event?.[t.colorId]?.background) || (cal?.backgroundColor as string) || '#4285f4'
            return { key: t.id, ev, calendar: cal, color }
          }}
          onOpenEditor={() => {
            const d = quick
            setQuick(null)
            startCreate(d)
          }}
        />
      )}
    </>
  )

  return {
    writable,
    undo,
    canCreate: eventCalendars.length > 0,
    canMemo: !!memoCalendar,
    hasTestCalendar,
    hasMemoCalendar,
    isMemo,
    canEdit,
    startCreate,
    startEdit,
    startDelete,
    startMemo,
    createCalendar,
    templates,
    setTemplates,
    saveAsTemplate,
    startQuickAdd,
    stamp,
    stampDay,
    stopStamp: () => {
      if (stamp) onNotice(`「${stamp.template.title}」を ${stamp.count} 件登録しました`)
      setStamp(null)
    },
    dialogs,
  }
}
