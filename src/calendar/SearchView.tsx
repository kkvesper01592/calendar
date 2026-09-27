import { useEffect, useState } from 'react'
import type { AccessToken } from '../google/auth'
import type { CalendarEvent, CalendarListEntry } from '../google/calendarReadApi'
import { describeWhen, eventRange } from '../lib/dates'
import type { Colors, DisplayEvent } from './useRangeEvents'
import { searchEvents } from './searchIndex'
import { EventBody } from './EventDetail'
import { useMediaQuery } from '../lib/useMediaQuery'
import { lineHits, plainText, searchWords } from '../lib/highlight'
import Highlight from './Highlight'
import type { OfflineSnapshot } from '../offline/offlineStore'

/** 予定のうち、検索語を含む行(場所とメモの各行)をすべて取り出す */
function hitLines(ev: CalendarEvent, words: string[]): { label?: string; text: string }[] {
  const out: { label?: string; text: string }[] = []
  if (ev.location && lineHits(ev.location, words)) out.push({ label: '場所', text: ev.location })
  if (ev.description) {
    for (const line of plainText(ev.description).split('\n')) {
      if (line.trim() && lineHits(line, words)) out.push({ text: line.trim() })
    }
  }
  return out
}

interface Props {
  token: AccessToken | null
  offline: OfflineSnapshot | null // オフライン中は保存した予定から探す
  calendars: CalendarListEntry[]
  colors: Colors | null
  query: string
  reloadKey: number
  onOpen: (e: DisplayEvent) => void
  onClose: () => void
  onError: (e: unknown) => void
}

/** 検索結果: 今日以降の予定と過去の予定(新しい順)に分けて表示。スペース区切りは「すべて含む」 */
export default function SearchView({ token, offline, calendars, colors, query, reloadKey, onOpen, onClose, onError }: Props) {
  const [results, setResults] = useState<DisplayEvent[] | null>(null)
  const [progress, setProgress] = useState('')
  const [preview, setPreview] = useState<DisplayEvent | null>(null)
  // マウスが使える広い画面だけ、カーソルを合わせた予定を横に表示する
  const canPreview = useMediaQuery('(hover: hover) and (min-width: 900px)')

  useEffect(() => {
    let cancelled = false
    setResults(null)
    setPreview(null)
    searchEvents(token, calendars, colors, query, reloadKey, setProgress, offline)
      .then((found) => !cancelled && setResults(found))
      .catch((e) => !cancelled && onError(e))
    return () => {
      cancelled = true
    }
  }, [token, offline, calendars, colors, query, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const words = searchWords(query)
  const now = Date.now()
  const upcoming = results?.filter((r) => eventRange(r.ev).end.getTime() >= now) ?? []
  const past = (results?.filter((r) => eventRange(r.ev).end.getTime() < now) ?? []).reverse()

  const list = (items: DisplayEvent[]) => (
    <ul className="rows">
      {items.map((item) => (
        <li key={item.key}>
          <button
            className={`row search-row ${preview?.key === item.key ? 'hovered' : ''}`}
            onClick={() => onOpen(item)}
            onMouseEnter={() => canPreview && setPreview(item)}
            onFocus={() => canPreview && setPreview(item)}
          >
            <span className="bar" style={{ background: item.color }} />
            <span className="search-main">
              <span className="search-row-head">
                <span className="row-when">{describeWhen(item.ev)}</span>
                <span className="row-title">
                  <Highlight text={item.ev.summary || '(タイトルなし)'} words={words} />
                </span>
              </span>
              {/* タイトル以外で一致した行(場所・メモ)をすべて表示 */}
              {hitLines(item.ev, words).map((l, i) => (
                <span key={i} className="search-line">
                  {l.label && <span className="line-label">{l.label}</span>}
                  <Highlight text={l.text} words={words} />
                </span>
              ))}
            </span>
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
          <p className="muted small-text">{results.length} 件(タイトル・メモ・場所から検索。一致した言葉に色を付け、タイトルの下に一致した行を表示)</p>
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
            <EventBody item={preview} words={words} />
            <p className="muted small-text">クリックで詳細を開きます</p>
          </>
        ) : (
          <p className="muted">項目にカーソルを合わせると、ここに内容が表示されます</p>
        )}
      </aside>
    </div>
  )
}
