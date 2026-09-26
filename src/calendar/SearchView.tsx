import { useEffect, useState } from 'react'
import type { AccessToken } from '../google/auth'
import { listAllExpanded, type CalendarEvent, type CalendarListEntry } from '../google/calendarReadApi'
import { describeWhen, eventRange } from '../lib/dates'
import { toDisplay, type Colors, type DisplayEvent } from './useRangeEvents'
import { EventBody } from './EventDetail'
import { useMediaQuery } from '../lib/useMediaQuery'

interface Props {
  token: AccessToken
  calendars: CalendarListEntry[]
  colors: Colors | null
  query: string
  reloadKey: number
  onOpen: (e: DisplayEvent) => void
  onClose: () => void
  onError: (e: unknown) => void
}

// 検索用に読み込んだ予定(メモリ上だけ)。「更新」を押すと読み直す
const indexCache = new Map<string, CalendarEvent[]>()
let cacheReloadKey = -1

/** 全角/半角・大文字/小文字・数字のカンマ区切りの違いを無視して比べるための正規化 */
function normalize(s: string | undefined): string {
  return (s ?? '')
    .replace(/<[^>]*>/g, ' ') // 説明欄の HTML タグ
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(\d),(?=\d{3})/g, '$1')
}

function matches(ev: CalendarEvent, words: string[]): boolean {
  const text = normalize([ev.summary, ev.description, ev.location].join('\n'))
  return words.every((w) => text.includes(w))
}

/** 検索結果: 今日以降の予定と過去の予定(新しい順)に分けて表示。スペース区切りは「すべて含む」 */
export default function SearchView({ token, calendars, colors, query, reloadKey, onOpen, onClose, onError }: Props) {
  const [results, setResults] = useState<DisplayEvent[] | null>(null)
  const [progress, setProgress] = useState('')
  const [preview, setPreview] = useState<DisplayEvent | null>(null)
  // マウスが使える広い画面だけ、カーソルを合わせた予定を横に表示する
  const canPreview = useMediaQuery('(hover: hover) and (min-width: 900px)')

  useEffect(() => {
    let cancelled = false
    setResults(null)
    setPreview(null)
    if (cacheReloadKey !== reloadKey) {
      indexCache.clear()
      cacheReloadKey = reloadKey
    }
    const words = normalize(query).split(/\s+/).filter(Boolean)
    ;(async () => {
      const found: DisplayEvent[] = []
      for (const [i, cal] of calendars.entries()) {
        let items = indexCache.get(cal.id)
        if (!items) {
          setProgress(`予定を読み込み中… (${i + 1}/${calendars.length})`)
          items = await listAllExpanded(token, cal.id)
          indexCache.set(cal.id, items)
        }
        for (const ev of items) if (ev.status !== 'cancelled' && ev.start && matches(ev, words)) found.push(toDisplay(ev, cal, colors))
      }
      if (cancelled) return
      found.sort((a, b) => eventRange(a.ev).start.getTime() - eventRange(b.ev).start.getTime())
      setResults(found)
    })().catch((e) => !cancelled && onError(e))
    return () => {
      cancelled = true
    }
  }, [token, calendars, colors, query, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const now = Date.now()
  const upcoming = results?.filter((r) => eventRange(r.ev).end.getTime() >= now) ?? []
  const past = (results?.filter((r) => eventRange(r.ev).end.getTime() < now) ?? []).reverse()

  const list = (items: DisplayEvent[]) => (
    <ul className="rows">
      {items.map((item) => (
        <li key={item.key}>
          <button
            className={`row ${preview?.key === item.key ? 'hovered' : ''}`}
            onClick={() => onOpen(item)}
            onMouseEnter={() => canPreview && setPreview(item)}
            onFocus={() => canPreview && setPreview(item)}
          >
            <span className="bar" style={{ background: item.color }} />
            <span className="row-when">{describeWhen(item.ev)}</span>
            <span className="row-title">{item.ev.summary || '(タイトルなし)'}</span>
          </button>
        </li>
      ))}
    </ul>
  )

  const resultList = (
    <section className="card search">
      <div className="search-head">
        <h2>「{query}」の検索結果</h2>
        <button className="small ghost" onClick={onClose}>閉じる</button>
      </div>
      {results === null ? (
        <p className="muted">{progress || '検索中…'}</p>
      ) : results.length === 0 ? (
        <p className="muted">見つかりませんでした(表示中のカレンダーの、タイトル・メモ・場所を検索します)</p>
      ) : (
        <>
          <p className="muted small-text">{results.length} 件(タイトル・メモ・場所から検索)</p>
          {upcoming.length > 0 && (
            <>
              <h3>今日以降({upcoming.length})</h3>
              {list(upcoming)}
            </>
          )}
          {past.length > 0 && (
            <>
              <h3>過去(新しい順・{past.length})</h3>
              {list(past)}
            </>
          )}
        </>
      )}
    </section>
  )

  if (!canPreview || !results?.length) return resultList
  return (
    <div className="search-split">
      {resultList}
      <aside className="card search-preview" aria-live="polite">
        {preview ? (
          <>
            <div className="modal-bar" style={{ background: preview.color }} />
            <EventBody item={preview} />
            <p className="muted small-text">クリックで詳細を開きます</p>
          </>
        ) : (
          <p className="muted">項目にカーソルを合わせると、ここに内容が表示されます</p>
        )}
      </aside>
    </div>
  )
}
