import { useCallback, useEffect, useMemo, useState } from 'react'
import { SCOPE_APP_CREATED, SCOPE_CALENDAR_READONLY, SCOPE_EVENTS } from './config'
import { requestAccessToken, revokeToken, type AccessToken } from './google/auth'
import { AuthExpiredError, getColors, listCalendars, type CalendarListEntry } from './google/calendarReadApi'
import { useRangeEvents, type Colors, type DisplayEvent } from './calendar/useRangeEvents'
import MonthView from './calendar/MonthView'
import TimeGridView from './calendar/TimeGridView'
import YearView from './calendar/YearView'
import DayList from './calendar/DayList'
import EventDetail from './calendar/EventDetail'
import SearchView from './calendar/SearchView'
import { searchEvents } from './calendar/searchIndex'
import { HoverCard, useHoverPreview } from './calendar/HoverPreview'
import BackupPanel from './backup/BackupPanel'
import ChangeHistory from './backup/ChangeHistory'
import { getAutoDir, isDueToday, permission, requestPermission, runBackupTo } from './backup/autoBackup'
import { canPickFolder } from './backup/saveToFolder'
import { eventRange, isAllDay, sameDay, shiftCursor, viewRange, viewTitle, weekDaysOf, ymd, type ViewKind } from './lib/dates'
import { canEditExisting, isMemoCalendar, setEditableCalendars } from './google/calendarWriteApi'
import { applyPrefs, loadPrefs, PrefsContext, savePrefs, type Prefs } from './settings/prefs'
import SettingsPanel from './settings/SettingsPanel'
import { useMediaQuery } from './lib/useMediaQuery'
import { useEditing } from './editing/useEditing'

// 表示設定(端末ごと)。保存できない環境でも既定値で動く
function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`webcalendar.${key}`)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}
function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`webcalendar.${key}`, JSON.stringify(value))
  } catch {
    /* 保存できなくても表示には影響しない */
  }
}

const VIEWS: { kind: ViewKind; label: string }[] = [
  { kind: 'year', label: '年' },
  { kind: 'month', label: '月' },
  { kind: 'week', label: '週' },
  { kind: 'day', label: '日' },
]

type AutoState = { kind: 'idle' } | { kind: 'needPermission' } | { kind: 'running' } | { kind: 'done'; msg: string } | { kind: 'error'; msg: string }

export default function App() {
  const [token, setToken] = useState<AccessToken | null>(null)
  const [expired, setExpired] = useState(false)
  const [calendars, setCalendars] = useState<CalendarListEntry[]>([])
  const [colors, setColors] = useState<Colors | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(loadPref<string[]>('hiddenCalendars', [])))
  const [showRokuyo, setShowRokuyo] = useState(() => loadPref('showRokuyo', true))
  const [showTime, setShowTime] = useState(() => loadPref('showTime', true))
  const [view, setView] = useState<ViewKind>(() => loadPref<ViewKind>('view', 'month'))
  const [cursor, setCursor] = useState(() => new Date())
  const [selected, setSelected] = useState(() => new Date())
  const [openEvent, setOpenEvent] = useState<DisplayEvent | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [tab, setTab] = useState<'calendar' | 'backup' | 'settings'>('calendar')
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [notice, setNotice] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState('')
  const [auto, setAuto] = useState<AutoState>({ kind: 'idle' })

  // 見た目の設定を画面に反映
  useEffect(() => applyPrefs(prefs), [prefs])
  const setPrefs = (p: Prefs) => {
    setPrefsState(p)
    savePrefs(p)
  }
  const weekOpts = { weekStart: prefs.weekStart, weekDays: prefs.weekDays }
  // 編集を許可した既存カレンダーを書き込み処理に伝える(描画の前に反映)
  setEditableCalendars(prefs.editableCalendars)
  // お知らせは数秒で消す
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(t)
  }, [notice])

  const wide = useMediaQuery('(min-width: 1100px)')
  const chipsClickable = useMediaQuery('(min-width: 761px)')
  const canHover = useMediaQuery('(hover: hover)')
  const hover = useHoverPreview(canHover)
  // 予定を開くときはカーソルのカードを消す
  const openItem = useCallback((item: DisplayEvent) => {
    hover.hide()
    setOpenEvent(item)
  }, [hover.hide]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleError = useCallback((e: unknown) => {
    if (e instanceof AuthExpiredError) {
      setExpired(true)
      return
    }
    setError(e instanceof Error ? e.message : String(e))
  }, [])

  async function login() {
    setError('')
    try {
      // 閲覧は必須。書き込み(アプリ作成カレンダー / 既存カレンダーの予定)は任意の許可。
      // 既存カレンダーは、許可されても設定画面でカレンダーごとに許可するまで書き込まない
      const t = await requestAccessToken(SCOPE_CALENDAR_READONLY, [SCOPE_APP_CREATED, SCOPE_EVENTS])
      setToken(t)
      setExpired(false)
    } catch (e) {
      handleError(e)
    }
  }

  async function logout() {
    if (token) await revokeToken(token)
    setToken(null)
    setCalendars([])
  }

  // ログイン後: カレンダー一覧と色
  useEffect(() => {
    if (!token || calendars.length) return
    Promise.all([listCalendars(token), getColors(token)])
      .then(([list, cols]) => {
        setCalendars(list.items)
        setColors(cols as Colors)
        // 初回は Google の「日本の祝日」を隠す(祝日はアプリ側で表示するため)
        if (loadPref<string[] | null>('hiddenCalendars', null) === null) {
          const ids = list.items.filter((c) => /holiday@group\.v\.calendar\.google\.com$/.test(c.id)).map((c) => c.id)
          setHidden(new Set(ids))
          savePref('hiddenCalendars', ids)
        }
      })
      .catch(handleError)
  }, [token, calendars.length, handleError])

  // その日最初の自動バックアップ
  useEffect(() => {
    if (!token || !calendars.length || !canPickFolder() || !isDueToday()) return
    let stop = false
    ;(async () => {
      const dir = await getAutoDir()
      if (!dir || stop) return
      if ((await permission(dir)) !== 'granted') return setAuto({ kind: 'needPermission' })
      await runAuto(dir)
    })()
    return () => {
      stop = true
    }
  }, [token, calendars.length]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runAuto(dir: FileSystemDirectoryHandle) {
    if (!token) return
    setAuto({ kind: 'running' })
    try {
      const r = await runBackupTo(dir, token)
      setAuto({ kind: 'done', msg: `今日の自動バックアップを保存しました(${r.folderName}、予定 ${r.events} 件)` })
    } catch (e) {
      if (e instanceof AuthExpiredError) setExpired(true)
      setAuto({ kind: 'error', msg: `自動バックアップに失敗しました: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  async function allowAndRunAuto() {
    const dir = await getAutoDir()
    if (dir && (await requestPermission(dir))) await runAuto(dir)
    else setAuto({ kind: 'error', msg: '保存先フォルダへの書き込みが許可されませんでした' })
  }

  function toggleCalendar(id: string) {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setHidden(next)
    savePref('hiddenCalendars', [...next])
  }

  function changeView(v: ViewKind) {
    setView(v)
    savePref('view', v)
    setSearchQuery('')
    setTab('calendar')
    // 週・日表示は選択中の日を基準にする
    if (v === 'week' || v === 'day') setCursor(selected)
  }

  const { start, end } = viewRange(view, cursor, weekOpts)
  const visibleCalendars = useMemo(() => calendars.filter((c) => !hidden.has(c.id)), [calendars, hidden])
  const { byDay, loading } = useRangeEvents(token, calendars, hidden, colors, start, end, reloadKey, handleError)
  const selectedEvents = byDay.get(ymd(selected)) ?? []
  const editing = useEditing({
    token,
    calendars,
    colors,
    onChanged: () => setReloadKey((k) => k + 1),
    onCalendarsChanged: () => setCalendars([]),
    onError: handleError,
    onNotice: setNotice,
    // 追加画面の「予定の検索」: 表示中のカレンダー(日付メモを除く)から探す
    searchPast: token ? (q) => searchEvents(token, visibleCalendars.filter((c) => !isMemoCalendar(c)), colors, q, reloadKey) : undefined,
    suggestStart: (date) => {
      // その日に終わる時間指定の予定のうち、一番遅い終了時刻(終日・日付メモ・翌日にまたがる予定は除く)
      const ends = (byDay.get(ymd(date)) ?? [])
        .filter((e) => !isAllDay(e.ev) && !isMemoCalendar(e.calendar))
        .map((e) => eventRange(e.ev).end)
        .filter((end) => sameDay(end, date))
      return ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : undefined
    },
  })
  const dayListEditProps = {
    isMemo: editing.isMemo,
    onAdd: editing.canCreate ? () => editing.startCreate(selected) : undefined,
    onMemo: editing.canMemo ? (existing?: DisplayEvent) => editing.startMemo(selected, existing) : undefined,
    dayColor: prefs.dayColors[ymd(selected)],
    onDayColor: (c: string | null) => {
      const next = { ...prefs.dayColors }
      if (c) next[ymd(selected)] = c
      else delete next[ymd(selected)]
      setPrefs({ ...prefs, dayColors: next })
    },
  }

  const goToday = () => {
    const t = new Date()
    setCursor(t)
    setSelected(t)
  }
  const selectDay = (d: Date) => {
    setSelected(d)
    if (view === 'month' && d.getMonth() !== cursor.getMonth()) setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
    if (!wide) setSheetOpen(true)
  }
  const showDay = (d: Date) => {
    setSelected(d)
    setCursor(d)
    setView('day')
    savePref('view', 'day')
    setOpenEvent(null)
    setSheetOpen(false)
    setSearchQuery('')
  }

  if (!token) {
    return (
      <main className="login-screen">
        <h1>WebCalendar</h1>
        <p className="muted">Google カレンダーの予定を表示・編集します</p>
        <button onClick={login}>Google にログイン</button>
        {error && <p className="error">{error}</p>}
      </main>
    )
  }

  const settings = (
    <aside className="side">
      <details open={wide}>
        <summary>カレンダーと表示設定</summary>
        <ul className="cal-list">
          {calendars.map((c) => (
            <li key={c.id}>
              <label>
                <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggleCalendar(c.id)} />
                <span className="swatch" style={{ background: c.backgroundColor as string }} />
                {c.summaryOverride || c.summary}
              </label>
            </li>
          ))}
        </ul>
        <div className="opts write-opts">
          {!editing.writable ? (
            <p className="hint small-text">
              書き込みの許可がありません。予定を追加するには、ログアウトして再ログインし「このアプリで作成したカレンダー」の許可にチェックを入れてください。
            </p>
          ) : (
            <>
              {!editing.hasTestCalendar && (
                <button className="small ghost" onClick={() => editing.createCalendar('test')}>テスト用カレンダーを作成</button>
              )}
              {!editing.hasMemoCalendar && (
                <button className="small ghost" onClick={() => editing.createCalendar('memo')}>メモ用カレンダーを作成</button>
              )}
              <p className="hint small-text">既存のカレンダーは、「設定」で編集を許可したものだけ書き込めます(最初はすべて閲覧のみ)。</p>
            </>
          )}
        </div>
        <div className="opts">
          <label className="opt">
            <input type="checkbox" checked={showTime} onChange={() => (setShowTime(!showTime), savePref('showTime', !showTime))} /> 予定の時刻を表示
          </label>
          <label className="opt">
            <input type="checkbox" checked={showRokuyo} onChange={() => (setShowRokuyo(!showRokuyo), savePref('showRokuyo', !showRokuyo))} /> 六曜を表示
          </label>
        </div>
      </details>
    </aside>
  )

  let body
  if (tab === 'settings') {
    body = (
      <main className="single">
        <SettingsPanel
          prefs={prefs}
          onChange={setPrefs}
          templates={editing.templates}
          onTemplatesChange={editing.setTemplates}
          calendars={calendars}
          canEditExisting={canEditExisting(token)}
        />
      </main>
    )
  } else if (tab === 'backup') {
    body = (
      <main className="single">
        <BackupPanel token={token} onError={handleError} onDone={() => setAuto({ kind: 'idle' })} />
        <ChangeHistory onUndo={(entry, done) => editing.undo(entry, done)} />
      </main>
    )
  } else if (searchQuery) {
    body = (
      <main className="single search-wide">
        <SearchView
          token={token}
          calendars={visibleCalendars}
          colors={colors}
          query={searchQuery}
          reloadKey={reloadKey}
          onOpen={setOpenEvent}
          onClose={() => setSearchQuery('')}
          onError={handleError}
        />
      </main>
    )
  } else {
    let content
    if (view === 'month') {
      content = (
        <MonthView
          year={cursor.getFullYear()}
          month0={cursor.getMonth()}
          byDay={byDay}
          selected={selected}
          onSelect={editing.stamp ? editing.stampDay : selectDay}
          onOpen={openItem}
          showRokuyo={showRokuyo}
          showTime={showTime}
          chipsClickable={chipsClickable}
          hover={hover.handlers}
          isMemo={editing.isMemo}
          onCreate={editing.canCreate && !editing.stamp ? (d) => editing.startCreate(d) : undefined}
          onQuickAdd={editing.canCreate ? editing.startQuickAdd : undefined}
        />
      )
    } else if (view === 'year') {
      content = (
        <YearView
          year={cursor.getFullYear()}
          byDay={byDay}
          onPickDay={showDay}
          onPickMonth={(m) => {
            setCursor(new Date(cursor.getFullYear(), m, 1))
            changeView('month')
          }}
        />
      )
    } else {
      const days = view === 'week' ? weekDaysOf(cursor, weekOpts) : [cursor]
      content = (
        <TimeGridView
          days={days}
          byDay={byDay}
          onOpen={openItem}
          onPickDay={view === 'week' ? showDay : undefined}
          showRokuyo={showRokuyo}
          showTime={showTime}
          hover={hover.handlers}
          onCreateAt={editing.canCreate ? (d, h) => editing.startCreate(d, h) : undefined}
        />
      )
    }
    const sidePanel = view === 'month' && wide
    body = (
      <main className={`layout ${sidePanel ? 'with-panel' : ''}`}>
        {settings}
        {content}
        {sidePanel && (
          <DayList day={selected} events={selectedEvents} showTime={showTime} onOpen={openItem} hover={hover.handlers} {...dayListEditProps} />
        )}
      </main>
    )
  }

  return (
    <PrefsContext.Provider value={prefs}>
    <div className="app">
      <header className="topbar">
        <div className="nav">
          <button className="icon" onClick={() => setCursor(shiftCursor(view, cursor, -1, weekOpts))} aria-label="前へ">‹</button>
          <h1 className="title">{viewTitle(view, cursor, weekOpts)}</h1>
          <button className="icon" onClick={() => setCursor(shiftCursor(view, cursor, 1, weekOpts))} aria-label="次へ">›</button>
          <button className="small ghost" onClick={goToday}>今日</button>
          {loading && <span className="muted small-text">読み込み中…</span>}
        </div>
        <div className="seg" role="tablist" aria-label="表示の切り替え">
          {VIEWS.map((v) => (
            <button key={v.kind} role="tab" aria-selected={view === v.kind && tab === 'calendar' && !searchQuery} className={view === v.kind && tab === 'calendar' && !searchQuery ? 'on' : ''} onClick={() => changeView(v.kind)}>
              {v.label}
            </button>
          ))}
        </div>
        <form
          className="search-box"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            const q = searchInput.trim()
            if (q) {
              setSearchQuery(q)
              setTab('calendar')
            }
          }}
        >
          <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="予定を検索" aria-label="予定を検索" />
          <button className="small" type="submit">検索</button>
        </form>
        <div className="menu">
          {editing.canCreate && (
            <button className="small" onClick={() => editing.startCreate(selected)}>＋ 予定</button>
          )}
          <button className={`small ghost ${tab === 'backup' ? 'active' : ''}`} onClick={() => setTab(tab === 'backup' ? 'calendar' : 'backup')}>
            バックアップ
          </button>
          <button className={`small ghost ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab(tab === 'settings' ? 'calendar' : 'settings')}>
            設定
          </button>
          <button className="small ghost" onClick={() => setReloadKey((k) => k + 1)} title="Google から再読み込み">更新</button>
          <button className="small ghost" onClick={logout}>ログアウト</button>
        </div>
      </header>

      {expired && (
        <div className="banner warn-banner">
          ログインの有効期限が切れました。<button className="small" onClick={login}>再ログイン</button>
        </div>
      )}
      {auto.kind === 'needPermission' && (
        <div className="banner">
          今日の自動バックアップには、保存先フォルダへの書き込みの許可が必要です。
          <button className="small" onClick={allowAndRunAuto}>許可してバックアップ</button>
        </div>
      )}
      {auto.kind === 'running' && <div className="banner">今日の自動バックアップを保存中…</div>}
      {auto.kind === 'done' && (
        <div className="banner ok-banner">
          {auto.msg} <button className="link" onClick={() => setAuto({ kind: 'idle' })}>閉じる</button>
        </div>
      )}
      {auto.kind === 'error' && <div className="banner warn-banner">{auto.msg}</div>}
      {editing.stamp && (
        <div className="banner stamp-banner">
          スタンプモード: 日付を押すと「{editing.stamp.template.title || '(タイトルなし)'}」を登録します(登録済み {editing.stamp.count} 件)
          <button className="small" onClick={editing.stopStamp}>終了</button>
        </div>
      )}
      {notice && <div className="banner ok-banner">{notice}</div>}
      {error && (
        <div className="banner warn-banner">
          エラー: {error} <button className="link" onClick={() => setError('')}>閉じる</button>
        </div>
      )}

      {body}

      {sheetOpen && !wide && view === 'month' && tab === 'calendar' && !searchQuery && (
        <div className="sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <DayList
              day={selected}
              events={selectedEvents}
              showTime={showTime}
              onOpen={openItem}
              onClose={() => setSheetOpen(false)}
              hover={hover.handlers}
              {...dayListEditProps}
            />
          </div>
        </div>
      )}

      {hover.shown && !openEvent && <HoverCard {...hover.shown} />}
      {openEvent && (
        <EventDetail
          item={openEvent}
          onClose={() => setOpenEvent(null)}
          onShowDay={showDay}
          onEdit={editing.canEdit(openEvent) ? () => (setOpenEvent(null), editing.startEdit(openEvent)) : undefined}
          onDelete={editing.canEdit(openEvent) ? () => editing.startDelete(openEvent, () => setOpenEvent(null)) : undefined}
          onSaveTemplate={editing.isMemo(openEvent) ? undefined : () => editing.saveAsTemplate(openEvent)}
        />
      )}
      {editing.dialogs}
    </div>
    </PrefsContext.Provider>
  )
}
