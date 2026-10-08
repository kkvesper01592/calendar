import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { getAutoDir, setAutoDir, isDueToday, lastLatestBackup, permission, requestPermission, runBackupTo, runLatestBackupTo } from './backup/autoBackup'
import { canPickFolder, pickFolder } from './backup/saveToFolder'
import { eventRange, isAllDay, sameDay, shiftCursor, viewRange, viewTitle, weekDaysOf, ymd, type ViewKind } from './lib/dates'
import { canEditExisting, canWrite, isMemoCalendar, isSettingsCalendar, setEditableCalendars } from './google/calendarWriteApi'
import { applyPrefs, loadPrefs, PrefsContext, savePrefs, type Prefs } from './settings/prefs'
import SettingsPanel from './settings/SettingsPanel'
import ImportPanel from './importing/ImportPanel'
import { useMediaQuery } from './lib/useMediaQuery'
import { useEditing } from './editing/useEditing'
import { useNewerVersion, versionDetail, versionLabel } from './lib/version'
import { searchWords } from './lib/highlight'
import {
  loadCloudSettings,
  localDeviceAt,
  localSharedAt,
  pickShared,
  saveCloudSettings,
  setLocalDeviceAt,
  setLocalSharedAt,
  setRememberedFolder,
  type DeviceKind,
} from './settings/cloudSettings'
import type { Template } from './editing/templates'
import { applyLocalSettings, readSettingsFromFolder, settingsWereMissing, writeSettingsToFolder } from './settings/settingsBackup'
import {
  clearSnapshot,
  isNetworkError,
  loadSnapshot,
  putSnapshot,
  readSnapshotFromFolder,
  saveSnapshot,
  snapshotCount,
  writeSnapshotToFolder,
  type OfflineSnapshot,
} from './offline/offlineStore'

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

// 一度ログインを許可した端末の印(2回目から確認画面を出さない)
const LOGGED_IN = 'webcalendar.loggedIn'

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
  const [allCalendars, setCalendars] = useState<CalendarListEntry[]>([])
  // 画面に出すカレンダー(設定の保存用カレンダーは除く)
  const calendars = useMemo(() => allCalendars.filter((c) => !isSettingsCalendar(c)), [allCalendars])
  const [colors, setColors] = useState<Colors | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(loadPref<string[]>('hiddenCalendars', [])))
  const [showRokuyo, setShowRokuyo] = useState(() => loadPref('showRokuyo', true))
  const [showTime, setShowTime] = useState(() => loadPref('showTime', true))
  // 「カレンダーと表示設定」の欄を開いているか(前回の状態を覚える。初めては広い画面なら開く)
  const [sideOpen, setSideOpen] = useState<boolean | null>(() => loadPref<boolean | null>('sideOpen', null))
  const [view, setView] = useState<ViewKind>(() => loadPref<ViewKind>('view', 'month'))
  const [cursor, setCursor] = useState(() => new Date())
  const [selected, setSelected] = useState(() => new Date())
  const [openEvent, setOpenEvent] = useState<DisplayEvent | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [tab, setTab] = useState<'calendar' | 'backup' | 'settings' | 'import'>('calendar')
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [notice, setNotice] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState('')
  const [auto, setAuto] = useState<AutoState>({ kind: 'idle' })
  const newer = useNewerVersion()
  // オフライン表示中は、この端末に保存した予定(スナップショット)を使う。null ならふだんどおり Google から読む
  const [offlineSnap, setOfflineSnap] = useState<OfflineSnapshot | null>(null)
  const [savedInfo, setSavedInfo] = useState<{ savedAt: string; count: number } | null>(null) // 保存済みの内容
  const [offlineSync, setOfflineSync] = useState('') // 保存中の進み具合
  const [online, setOnline] = useState(() => navigator.onLine)
  const calendarsRef = useRef<CalendarListEntry[]>([])

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

  // エラー処理から最新の状態を参照するため
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const offlineRef = useRef(offlineSnap)
  offlineRef.current = offlineSnap
  const tokenRef = useRef(token)
  tokenRef.current = token
  calendarsRef.current = calendars
  const allCalendarsRef = useRef(allCalendars)
  allCalendarsRef.current = allCalendars
  const tokenValid = () => !!tokenRef.current && tokenRef.current.expiresAt - 60_000 > Date.now()

  /** 通信できなくなったとき: 保存した予定があればオフライン表示に切り替える */
  const goOffline = useCallback(async () => {
    if (offlineRef.current) return
    const snap = prefsRef.current.offlineCache ? await loadSnapshot() : undefined
    if (!snap) {
      setError('ネットにつながっていません。つながらないときにも予定を見られるようにするには、「設定」→「オフライン表示」をオンにしてください')
      return
    }
    setOfflineSnap(snap)
    setCalendars((cur) => (cur.length ? cur : snap.calendars))
    setColors((cur) => cur ?? snap.colors)
    setError('')
  }, [])

  const handleError = useCallback((e: unknown) => {
    if (e instanceof AuthExpiredError) {
      setExpired(true)
      return
    }
    if (isNetworkError(e)) {
      void goOffline()
      return
    }
    setError(e instanceof Error ? e.message : String(e))
  }, [goOffline])

  async function login() {
    setError('')
    // 一度許可した端末では、2回目から確認画面を出さない(写真日記と同じ。小さな画面が一瞬開いて自動で閉じる)
    let silent = false
    try {
      silent = localStorage.getItem(LOGGED_IN) === '1'
    } catch {
      /* 保存できない環境では毎回確認画面 */
    }
    try {
      // 閲覧は必須。書き込み(アプリ作成カレンダー / 既存カレンダーの予定)は任意の許可。
      // 既存カレンダーは、許可されても設定画面でカレンダーごとに許可するまで書き込まない
      const t = await requestAccessToken(SCOPE_CALENDAR_READONLY, [SCOPE_APP_CREATED, SCOPE_EVENTS], { silent })
      try {
        localStorage.setItem(LOGGED_IN, '1')
      } catch {
        /* 無視 */
      }
      const fromSaved = !!offlineRef.current
      // 保存した予定の表示から戻るとき: 先に表示を Google に切り替える
      offlineRef.current = null
      setOfflineSnap(null)
      tokenRef.current = t
      loginFresh.current = true // ログインしたら、予定の控えを取り直す
      setToken(t)
      setExpired(false)
      if (fromSaved) {
        // 保存した一覧ではなく最新の一覧に差し替える
        const [list, cols] = await Promise.all([listCalendars(t), getColors(t)])
        setCalendars(list.items)
        setColors(cols as Colors)
        setReloadKey((k) => k + 1)
      }
    } catch (e) {
      // 確認画面なしで失敗したときは、次は確認画面を出す
      if (silent) {
        try {
          localStorage.removeItem(LOGGED_IN)
        } catch {
          /* 無視 */
        }
      }
      handleError(e)
    }
  }
  const loginFresh = useRef(false)

  /**
   * ボタン操作の中から呼ぶ: ログインの残り時間が minMs 未満なら、確認画面なしでログインし直して新しいトークンを返す
   * (入力中に有効期限が切れて、入力をやり直すことにならないように)
   */
  const refreshing = useRef<Promise<AccessToken> | null>(null)
  const ensureToken = useCallback(async (minMs = 2 * 60_000): Promise<AccessToken> => {
    const t = tokenRef.current
    if (t && t.expiresAt - Date.now() > minMs) return t
    refreshing.current ??= requestAccessToken(SCOPE_CALENDAR_READONLY, [SCOPE_APP_CREATED, SCOPE_EVENTS], { silent: true })
      .then((nt) => {
        tokenRef.current = nt
        setToken(nt)
        setExpired(false)
        return nt
      })
      .catch((e) => {
        throw new Error(`ログインし直せませんでした(${e instanceof Error ? e.message : String(e)})。入力内容はそのまま残っています。もう一度押してください`)
      })
      .finally(() => {
        refreshing.current = null
      })
    return refreshing.current
  }, [])

  async function logout() {
    try {
      localStorage.removeItem(LOGGED_IN) // ログアウトしたら、次は確認画面から
    } catch {
      /* 無視 */
    }
    cloudStarted.current = false
    setCloudReady(false)
    if (token && online) await revokeToken(token).catch(() => {})
    setToken(null)
    setCalendars([])
    setOfflineSnap(null)
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

  // 一覧の中身が変わったときだけ差し替える(同じなら予定を読み直さない)
  const replaceCalendars = (items: CalendarListEntry[]) =>
    setCalendars((cur) => (JSON.stringify(cur) === JSON.stringify(items) ? cur : items))

  // 「更新」: Google で追加・名前変更したカレンダーも反映するため、一覧から読み直してから予定を読み込む
  async function refresh() {
    if (offlineSnap) {
      // オフライン表示中: つながっていれば最新に戻す(ログインが切れていればログインから)
      if (!navigator.onLine) return setNotice('まだネットにつながっていません')
      if (!tokenValid()) return login()
      setOfflineSnap(null)
    }
    if (token) {
      try {
        replaceCalendars((await listCalendars(token)).items)
      } catch (e) {
        handleError(e)
        return
      }
    }
    setReloadKey((k) => k + 1)
    void syncOffline(true)
  }

  // ---- オフライン表示用の保存(設定でオンにした端末だけ) ----
  const syncing = useRef(false)
  const [firstSaving, setFirstSaving] = useState(false) // この端末で初めて予定を保存している最中(終わるまで知らせ続ける)
  async function syncOffline(force: boolean) {
    const t = tokenRef.current
    if (!t || !tokenValid() || !prefsRef.current.offlineCache || offlineRef.current || syncing.current || !navigator.onLine) return
    // 前回の保存から30分たっていなければ、押したとき(force)以外は保存しない
    if (!force && savedInfo && Date.now() - new Date(savedInfo.savedAt).getTime() < 30 * 60_000) return
    syncing.current = true
    const first = !savedInfo // この端末で初めての保存(入れ直した直後など)
    if (first) setFirstSaving(true)
    try {
      const snap = await saveSnapshot(t, setOfflineSync)
      const count = snapshotCount(snap)
      setSavedInfo({ savedAt: snap.savedAt, count })
      void copyToFolder(snap)
      if (first) setNotice(`予定 ${count} 件をこの端末に保存しました。次からはログインする前でもすぐ表示されます`)
    } catch (e) {
      if (!isNetworkError(e)) {
        const msg = `予定をこの端末に保存できませんでした: ${e instanceof Error ? e.message : String(e)}(次にログインしたときにもう一度保存します)`
        setOfflineSync(msg)
        setError(msg)
      }
      return
    } finally {
      syncing.current = false
      setFirstSaving(false)
    }
    setOfflineSync('')
  }

  // ---- 2つ目の保存場所: PC の保存先フォルダの「最新\表示用の予定.json」 ----
  const [folderCopy, setFolderCopy] = useState('') // 保存先フォルダへの控えの状態
  async function copyToFolder(snap: OfflineSnapshot) {
    if (!canPickFolder()) return
    try {
      const dir = await getAutoDir()
      if (!dir) return setFolderCopy('保存先フォルダが未設定のため、フォルダには控えを置いていません(「バックアップ」画面で選べます)')
      if ((await permission(dir)) !== 'granted') return setFolderCopy('保存先フォルダへの書き込みの許可を待っているため、フォルダの控えは前回のままです')
      await writeSnapshotToFolder(dir, snap)
      await saveSettingsCopy(dir)
      setFolderCopy(`保存先フォルダ「${dir.name}\最新」にも予定と設定の控えを保存しました(${new Date().toLocaleString('ja-JP')})`)
    } catch (e) {
      setFolderCopy(`保存先フォルダに控えを保存できませんでした: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /**
   * 起動した時点でこの端末の設定が無かったとき: 保存先フォルダの設定の控えを書き戻して再読み込みする。
   * 戻したら true(この後は再読み込みされる)。1回の起動で1度だけ
   */
  const settingsRestored = useRef(false)
  const cloudReadyRef = useRef(false)
  /**
   * 設定の控えを書いてよいか。データが消えた直後は既定の設定になっているので、
   * フォルダから戻すか、Google に保存した設定と合わせ終わるまでは、フォルダの良い控えを上書きしない
   */
  const mayWriteSettings = () => !settingsWereMissing || settingsRestored.current || cloudReadyRef.current
  const saveSettingsCopy = async (dir: FileSystemDirectoryHandle) => {
    if (mayWriteSettings()) await writeSettingsToFolder(dir)
  }
  async function restoreSettingsFrom(dir: FileSystemDirectoryHandle): Promise<boolean> {
    if (!settingsWereMissing || settingsRestored.current) return false
    settingsRestored.current = true
    const data = await readSettingsFromFolder(dir)
    if (!data || !applyLocalSettings(data)) return false
    try {
      sessionStorage.setItem('webcalendar.restoredNotice', `保存先フォルダの控えから、予定と設定を戻しました(設定は ${new Date(data.savedAt).toLocaleString('ja-JP')} 時点)`)
    } catch {
      /* 無視 */
    }
    window.location.reload() // 戻した設定で画面を作り直す
    return true
  }
  // 設定を戻して再読み込みした後のお知らせ
  useEffect(() => {
    try {
      const msg = sessionStorage.getItem('webcalendar.restoredNotice')
      if (msg) {
        sessionStorage.removeItem('webcalendar.restoredNotice')
        setNotice(msg)
      }
    } catch {
      /* 無視 */
    }
  }, [])

  /** ブラウザの予定が消えていたとき: 保存先フォルダの控えから戻す(ボタン操作の中で呼ぶ。フォルダの許可・選択が必要なため) */
  async function restoreFromFolder() {
    setError('')
    try {
      let dir = await getAutoDir()
      if (!dir) {
        setNotice('バックアップの保存先フォルダ(「最新」フォルダがある場所)を選んでください')
        dir = await pickFolder()
      }
      if ((await permission(dir)) !== 'granted' && !(await requestPermission(dir))) {
        throw new Error('保存先フォルダの読み取りが許可されませんでした')
      }
      const snap = await readSnapshotFromFolder(dir)
      if (!snap) throw new Error(`「${dir.name}」の中に「最新\表示用の予定.json」が見つかりませんでした。バックアップの保存先フォルダを選んでください`)
      await putSnapshot(snap)
      await setAutoDir(dir) // 保存先フォルダも覚え直す(定期バックアップがまた動くように)
      if (await restoreSettingsFrom(dir)) return
      setSavedInfo({ savedAt: snap.savedAt, count: snapshotCount(snap) })
      offlineRef.current = null
      await goOffline()
      setNotice(`保存先フォルダの控えから、予定 ${snapshotCount(snap)} 件を戻しました(${new Date(snap.savedAt).toLocaleString('ja-JP')} 時点)`)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // 保存済みの内容を読む。ログインする前は、前回保存した予定をすぐ表示する(写真日記と同じ。ネットが無くても見られる)
  // ブラウザの予定が消えていても、保存先フォルダの許可が残っていれば、フォルダの控えから自動で戻す
  useEffect(() => {
    if (!prefs.offlineCache) return setSavedInfo(null)
    loadSnapshot().then(async (snap) => {
      if ((!snap || settingsWereMissing) && canPickFolder()) {
        try {
          const dir = await getAutoDir()
          if (dir && (await permission(dir)) === 'granted') {
            if (!snap) {
              const fromFolder = await readSnapshotFromFolder(dir)
              if (fromFolder) {
                await putSnapshot(fromFolder)
                snap = fromFolder
                setNotice('この端末の予定が消えていたため、保存先フォルダの控えから戻しました')
              }
            }
            if (await restoreSettingsFrom(dir)) return
          }
        } catch {
          /* 戻せなければ、ログイン画面の「バックアップから予定を戻す」で */
        }
      }
      if (!snap) return
      setSavedInfo({ savedAt: snap.savedAt, count: snapshotCount(snap) })
      if (!tokenRef.current) void goOffline()
    })
  }, [prefs.offlineCache]) // eslint-disable-line react-hooks/exhaustive-deps

  // ログインしたとき・予定を変更したあとに保存(ログイン直後は必ず、それ以外は30分に1回まで)
  useEffect(() => {
    if (!token || !calendars.length) return
    const force = loginFresh.current
    loginFresh.current = false
    void syncOffline(force)
  }, [token, calendars.length, reloadKey, prefs.offlineCache]) // eslint-disable-line react-hooks/exhaustive-deps

  // つながった/切れたの検知。つながったら、ログインが有効なら自動で最新に戻す
  useEffect(() => {
    const on = () => {
      setOnline(true)
      if (offlineRef.current && tokenValid()) {
        setOfflineSnap(null)
        setReloadKey((k) => k + 1)
        setNotice('ネットにつながったので、最新の予定に更新しました')
      }
    }
    const off = () => {
      setOnline(false)
      if (tokenRef.current || calendarsRef.current.length) void goOffline()
    }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [goOffline]) // eslint-disable-line react-hooks/exhaustive-deps

  // 回線はあるのに Google につながらなかった場合: オフライン表示中は1分ごとに確かめ、つながれば戻す
  useEffect(() => {
    if (!offlineSnap) return
    const timer = window.setInterval(async () => {
      const t = tokenRef.current
      if (!navigator.onLine || !t || !tokenValid()) return
      try {
        await listCalendars(t)
        setOfflineSnap(null)
        setReloadKey((k) => k + 1)
        setNotice('Google につながったので、最新の予定に更新しました')
      } catch {
        /* まだつながらない */
      }
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [offlineSnap]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 設定を Google にも保存(ブラウザのデータが消えても戻せるように) ----
  const device: DeviceKind = canPickFolder() ? 'pc' : 'mobile'
  const cloudStarted = useRef(false) // このログインで復元を始めたか
  const [cloudReady, setCloudReady] = useState(false) // 復元が終わり、変更を保存してよい状態か
  const [cloudStatus, setCloudStatus] = useState('')
  const lastSynced = useRef('') // 最後に Google と合わせた内容(変わったら保存する)
  const templatesRef = useRef<Template[]>([])
  const subsetOf = (p: Prefs, templates: Template[]) =>
    JSON.stringify({ shared: pickShared(p), templates, editable: [...p.editableCalendars].sort() })

  async function pushCloud() {
    const t = tokenRef.current
    if (!t || !tokenValid() || offlineRef.current || !navigator.onLine || !canWrite(t)) return
    const p = prefsRef.current
    const now = new Date().toISOString()
    const sharedAt = localSharedAt() || now
    const deviceAt = localDeviceAt() || now
    const folder = device === 'pc' ? (await getAutoDir())?.name : undefined
    try {
      const r = await saveCloudSettings(t, allCalendarsRef.current, (cur) => ({
        v: 1,
        // ほかの端末がもっと新しい内容を保存していたら、それは上書きしない
        shared:
          !cur.shared || sharedAt >= cur.shared.updatedAt
            ? { updatedAt: sharedAt, prefs: pickShared(p), templates: templatesRef.current }
            : cur.shared,
        devices: {
          ...cur.devices,
          [device]:
            !cur.devices[device] || deviceAt >= cur.devices[device]!.updatedAt
              ? { updatedAt: deviceAt, editableCalendars: p.editableCalendars, backupFolderName: folder ?? cur.devices[device]?.backupFolderName }
              : cur.devices[device],
        },
      }))
      if (!localSharedAt()) setLocalSharedAt(sharedAt)
      if (!localDeviceAt()) setLocalDeviceAt(deviceAt)
      setCloudStatus(`Google に保存済み(${new Date().toLocaleString('ja-JP')})`)
      if (r.createdCalendar) replaceCalendars((await listCalendars(t)).items)
    } catch (e) {
      if (!isNetworkError(e)) setCloudStatus(`Google への保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ログインしたら1回: Google の方が新しければ(端末の設定が消えていた場合も)Google の内容に戻す
  useEffect(() => {
    const t = offlineSnap ? null : token // オフライン表示中は Google に問い合わせない
    if (!t || !allCalendars.length || cloudStarted.current || !canWrite(t)) return
    cloudStarted.current = true
    ;(async () => {
      let next = prefsRef.current
      let templates = templatesRef.current
      let restored = false
      let needPush = false
      try {
        const cloud = await loadCloudSettings(t, allCalendars)
        const sh = cloud?.shared
        if (sh && (!localSharedAt() || sh.updatedAt > localSharedAt())) {
          next = { ...next, ...sh.prefs }
          templates = sh.templates ?? []
          setLocalSharedAt(sh.updatedAt)
          restored = true
        } else if (!sh || localSharedAt() > sh.updatedAt) needPush = true
        const dev = cloud?.devices[device]
        setRememberedFolder(dev?.backupFolderName)
        if (dev && (!localDeviceAt() || dev.updatedAt > localDeviceAt())) {
          next = { ...next, editableCalendars: dev.editableCalendars }
          setLocalDeviceAt(dev.updatedAt)
          restored = true
        } else if (!dev || localDeviceAt() > dev.updatedAt) needPush = true
        if (restored) {
          setPrefs(next)
          editing.setTemplates(templates)
          setNotice('Google に保存しておいた設定を戻しました')
        }
        setCloudStatus(cloud ? 'Google の設定と合わせました' : '')
      } catch (e) {
        if (!isNetworkError(e)) setCloudStatus(`Google の設定を読めませんでした: ${e instanceof Error ? e.message : String(e)}`)
        cloudStarted.current = false // 次の機会にもう一度
        return
      }
      lastSynced.current = subsetOf(next, templates)
      cloudReadyRef.current = true
      setCloudReady(true)
      if (needPush) void pushCloud()
    })()
  }, [token, offlineSnap, allCalendars]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setOfflineCache(on: boolean) {
    setPrefs({ ...prefs, offlineCache: on })
    prefsRef.current = { ...prefs, offlineCache: on }
    if (on) {
      void syncOffline(true)
    } else {
      await clearSnapshot().catch(() => {})
      setSavedInfo(null)
    }
  }

  // 設定画面を開いたときも一覧を読み直す(「既存カレンダーの編集」に新しいカレンダーを出すため)
  useEffect(() => {
    if (tab !== 'settings' || !token || offlineSnap) return
    let cancelled = false
    listCalendars(token)
      .then((list) => !cancelled && replaceCalendars(list.items))
      .catch(handleError)
    return () => {
      cancelled = true
    }
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // その日最初の自動バックアップ
  useEffect(() => {
    if (!token || offlineSnap || !calendars.length || !canPickFolder() || !isDueToday()) return
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
  }, [token, calendars.length, offlineSnap]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---- 開いている間の定期バックアップ(PC。保存先の「最新」フォルダに上書き。裏で行い、操作は止めない) ----
  const [periodic, setPeriodic] = useState<{ status: string; last: ReturnType<typeof lastLatestBackup> }>(() => ({ status: '', last: lastLatestBackup() }))
  const periodicRunning = useRef(false)
  async function runPeriodic() {
    if (periodicRunning.current) return
    const t = tokenRef.current
    if (offlineRef.current || !navigator.onLine) return setPeriodic((p) => ({ ...p, status: 'オフラインのため、つながるまで待っています' }))
    if (!t || !tokenValid()) return setPeriodic((p) => ({ ...p, status: 'ログインの有効期限が切れているため待っています(画面を操作するとログインし直します)' }))
    const dir = await getAutoDir()
    if (!dir) return setPeriodic((p) => ({ ...p, status: '保存先フォルダが未設定です' }))
    // 許可の確認はボタン操作の中でしか出せないので、許可が無いときは待つ(毎日の自動バックアップのお知らせから許可できる)
    if ((await permission(dir)) !== 'granted') return setPeriodic((p) => ({ ...p, status: '保存先フォルダへの書き込みの許可を待っています' }))
    periodicRunning.current = true
    setPeriodic((p) => ({ ...p, status: '保存中…' }))
    try {
      const last = await runLatestBackupTo(dir, t)
      await saveSettingsCopy(dir).catch(() => {})
      setPeriodic({ status: '', last })
    } catch (e) {
      setPeriodic((p) => ({ ...p, status: `失敗しました: ${e instanceof Error ? e.message : String(e)}(次の回にもう一度行います)` }))
    } finally {
      periodicRunning.current = false
    }
  }
  const loggedIn = !!token
  useEffect(() => {
    if (!loggedIn || !canPickFolder() || !prefs.periodicBackupMin) return
    const timer = window.setInterval(() => void runPeriodic(), prefs.periodicBackupMin * 60_000)
    return () => window.clearInterval(timer)
  }, [loggedIn, prefs.periodicBackupMin]) // eslint-disable-line react-hooks/exhaustive-deps

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

  /** 設定画面の「既存カレンダーの編集」を開く(確認画面から飛ぶとき) */
  function openEditSettings() {
    setOpenEvent(null)
    setSheetOpen(false)
    setTab('settings')
    window.setTimeout(() => {
      const el = document.getElementById('edit-existing')
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el?.classList.add('flash')
      window.setTimeout(() => el?.classList.remove('flash'), 1600)
    }, 50)
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
  // オフライン表示中は Google に問い合わせない・書き込まない
  const liveToken = offlineSnap ? null : token
  const { byDay, loading } = useRangeEvents(liveToken, offlineSnap, calendars, hidden, colors, start, end, reloadKey, handleError)
  const selectedEvents = byDay.get(ymd(selected)) ?? []
  // タイトルの入力候補の元: 保存した予定の控え(保存し直されたら読み直す)
  const [titleSnap, setTitleSnap] = useState<OfflineSnapshot | null>(null)
  useEffect(() => {
    if (offlineSnap) return setTitleSnap(offlineSnap)
    if (!savedInfo) return
    loadSnapshot().then((snap) => setTitleSnap(snap ?? null))
  }, [savedInfo?.savedAt, offlineSnap]) // eslint-disable-line react-hooks/exhaustive-deps

  const editing = useEditing({
    token: liveToken,
    titleSnap,
    calendars,
    colors,
    onChanged: () => setReloadKey((k) => k + 1),
    onCalendarsChanged: () => setCalendars([]),
    onError: handleError,
    onNotice: setNotice,
    onOpenEditSettings: openEditSettings,
    ensureToken,
    // 追加画面の「予定の検索」: 表示中のカレンダー(日付メモを除く)から探す
    searchPast: liveToken ? (q) => searchEvents(liveToken, visibleCalendars.filter((c) => !isMemoCalendar(c)), colors, q, reloadKey) : undefined,
    suggestStart: (date) => {
      // その日に終わる時間指定の予定のうち、一番遅い終了時刻(終日・日付メモ・翌日にまたがる予定は除く)
      const ends = (byDay.get(ymd(date)) ?? [])
        .filter((e) => !isAllDay(e.ev) && !isMemoCalendar(e.calendar))
        .map((e) => eventRange(e.ev).end)
        .filter((end) => sameDay(end, date))
      return ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : undefined
    },
  })
  // 設定を変えたら、数秒後に保存先フォルダの設定の控えも書き直す(PC。許可があるときだけ)
  const localSettingsKey = JSON.stringify([prefs, editing.templates, [...hidden], showTime, showRokuyo, view, sideOpen])
  useEffect(() => {
    if (!canPickFolder()) return
    const timer = window.setTimeout(async () => {
      try {
        const dir = await getAutoDir()
        if (dir && (await permission(dir)) === 'granted') await saveSettingsCopy(dir)
      } catch {
        /* 次の機会に */
      }
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [localSettingsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 設定・テンプレート・既存カレンダーの編集の許可を変えたら、数秒後に Google にも保存
  templatesRef.current = editing.templates
  const syncedSubset = subsetOf(prefs, editing.templates)
  useEffect(() => {
    if (!cloudReady || syncedSubset === lastSynced.current) return
    const prev = lastSynced.current ? (JSON.parse(lastSynced.current) as { shared: unknown; templates: unknown; editable: unknown }) : null
    const cur = JSON.parse(syncedSubset) as { shared: unknown; templates: unknown; editable: unknown }
    const now = new Date().toISOString()
    if (!prev || JSON.stringify([prev.shared, prev.templates]) !== JSON.stringify([cur.shared, cur.templates])) setLocalSharedAt(now)
    if (!prev || JSON.stringify(prev.editable) !== JSON.stringify(cur.editable)) setLocalDeviceAt(now)
    lastSynced.current = syncedSubset
    const timer = window.setTimeout(() => void pushCloud(), 3000)
    return () => window.clearTimeout(timer)
  }, [syncedSubset, cloudReady]) // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!token && !offlineSnap) {
    return (
      <main className="login-screen">
        <h1>WebCalendar</h1>
        <p className="muted">Google カレンダーの予定を表示・編集します</p>
        <button onClick={login}>Google にログイン</button>
        {!savedInfo && prefs.offlineCache && canPickFolder() && (
          <>
            <button className="ghost" onClick={() => void restoreFromFolder()}>
              バックアップから予定と設定を戻す
            </button>
            <p className="muted small-text">
              この端末に保存した予定が見つかりません(アプリの入れ直しなどで消えた可能性があります)。
              バックアップの保存先フォルダに控えがあれば、ログインしなくても予定と設定を戻せます。
            </p>
          </>
        )}
        {savedInfo && (
          <>
            <button className="ghost" onClick={() => void goOffline()}>
              オフラインで表示({new Date(savedInfo.savedAt).toLocaleString('ja-JP')} に保存した予定)
            </button>
            {!online && <p className="muted small-text">ネットにつながっていません。保存した予定を見ることはできます(追加・変更はできません)。</p>}
          </>
        )}
        {error && <p className="error">{error}</p>}
        <p className="muted small-text">{versionDetail}</p>
      </main>
    )
  }

  const settings = (
    <aside className="side">
      <details
        open={sideOpen ?? wide}
        onToggle={(e) => {
          const open = (e.currentTarget as HTMLDetailsElement).open
          if (open === (sideOpen ?? wide)) return // 表示の作り直しによるもの(状態は変わっていない)
          setSideOpen(open)
          savePref('sideOpen', open)
        }}
      >
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
  if (tab === 'import') {
    body = (
      <main className="single import-wide">
        <button className="small ghost back" onClick={() => setTab('settings')}>‹ 設定に戻る</button>
        {!liveToken ? (
          <p className="card warn">オフライン中は取り込みできません。</p>
        ) : (
        <ImportPanel
          token={liveToken}
          calendars={calendars}
          onCalendarsChanged={() => setCalendars([])}
          onDone={() => setReloadKey((k) => k + 1)}
          onError={handleError}
        />
        )}
      </main>
    )
  } else if (tab === 'settings') {
    body = (
      <main className="single">
        <SettingsPanel
          prefs={prefs}
          onChange={setPrefs}
          templates={editing.templates}
          titleIndex={editing.titleIndex}
          onTemplatesChange={editing.setTemplates}
          calendars={calendars}
          colors={colors}
          canEditExisting={canEditExisting(token)}
          onOpenImport={canPickFolder() ? () => setTab('import') : undefined}
          cloudStatus={cloudStatus}
          offline={{
            enabled: prefs.offlineCache,
            onToggle: setOfflineCache,
            savedInfo,
            status: [offlineSync, folderCopy].filter(Boolean).join(' / '),
            onSaveNow: liveToken ? () => void syncOffline(true) : undefined,
          }}
        />
      </main>
    )
  } else if (tab === 'backup') {
    body = (
      <main className="single">
        {liveToken ? (
          <BackupPanel
            token={liveToken}
            onError={handleError}
            onDone={() => setAuto({ kind: 'idle' })}
            periodic={{
              minutes: prefs.periodicBackupMin,
              onMinutes: (m) => setPrefs({ ...prefs, periodicBackupMin: m }),
              last: periodic.last,
              status: periodic.status,
              onRunNow: () => void runPeriodic(),
            }}
          />
        ) : (
          <p className="card warn">オフライン中はバックアップできません。ネットにつながってから「更新」を押してください。</p>
        )}
        <ChangeHistory onUndo={(entry, done) => editing.undo(entry, done)} />
      </main>
    )
  } else if (searchQuery) {
    body = (
      <main className="single search-wide">
        <SearchView
          token={liveToken}
          offline={offlineSnap}
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
          {editing.canCreate && !offlineSnap && (
            <button className="small" onClick={() => editing.startCreate(selected)}>＋ 予定</button>
          )}
          <button className={`small ghost ${tab === 'backup' ? 'active' : ''}`} onClick={() => setTab(tab === 'backup' ? 'calendar' : 'backup')}>
            バックアップ
          </button>
          <button className={`small ghost ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab(tab === 'settings' ? 'calendar' : 'settings')}>
            設定
          </button>
          <button className="small ghost" onClick={refresh} title={offlineSnap ? 'ネットにつながっていれば最新に戻す' : 'Google から再読み込み'}>
            更新
          </button>
          {token ? (
            <button className="small ghost" onClick={logout}>ログアウト</button>
          ) : (
            <button className="small" onClick={() => void login()} title="予定を最新にして、追加・変更をするため">
              Google にログイン
            </button>
          )}
          <button className="version-tag" title={`${versionDetail}(押すと設定で詳しく表示)`} onClick={() => setTab('settings')}>
            {versionLabel}
          </button>
        </div>
      </header>

      {newer && (
        <div className="banner">
          新しいヴァージョン(ver {newer.version}・{newer.built}・ビルド {newer.commit})が公開されています。
          <button className="small" onClick={() => window.location.reload()}>再読み込みして更新</button>
        </div>
      )}

      {firstSaving && (
        <div className="banner">
          予定をこの端末に保存しています…{offlineSync.replace(/^オフライン用に保存中…\s*/, '')}。保存が終わるまでアプリを閉じないでください。
        </div>
      )}
      {offlineSnap && (
        <div className={`banner ${online ? '' : 'warn-banner'}`}>
          {new Date(offlineSnap.savedAt).toLocaleString('ja-JP')} に保存した予定を表示しています(閲覧と検索のみ。追加・変更はログインしてから)。
          {online ? (
            <button className="small" onClick={refresh}>{tokenValid() ? '最新にする' : 'Google にログインして最新にする'}</button>
          ) : (
            ' ネットにつながっていません。つながると最新に戻せます。'
          )}
        </div>
      )}
      {expired && !offlineSnap && (
        <div className="banner warn-banner">
          ログインの有効期限が切れました。
          <button className="small" onClick={() => ensureToken(Number.MAX_SAFE_INTEGER).catch(() => login())}>再ログイン</button>
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
          onSaveTemplate={editing.isMemo(openEvent) || offlineSnap ? undefined : () => editing.saveAsTemplate(openEvent)}
          readOnlyNote={offlineSnap ? 'オフライン中は編集できません' : undefined}
          words={searchQuery && tab === 'calendar' ? searchWords(searchQuery) : undefined}
        />
      )}
      {editing.dialogs}
    </div>
    </PrefsContext.Provider>
  )
}
