import { useState } from 'react'
import { describeWhen, eventRange } from '../lib/dates'
import type { DisplayEvent } from '../calendar/useRangeEvents'
import { HoverCard, useHoverPreview } from '../calendar/HoverPreview'
import { useMediaQuery } from '../lib/useMediaQuery'
import type { TemplateTimeMode } from './templates'

interface Props {
  search: (query: string) => Promise<DisplayEvent[]>
  onApply: (item: DisplayEvent, mode: TemplateTimeMode) => void
  timeMode: TemplateTimeMode
  onTimeMode?: (m: TemplateTimeMode) => void
}

const LIMIT = 50

/** 予定の追加画面: 過去の予定を探して、内容をコピーする(検索 → クリックで選択 → 適用) */
export default function PastSearch({ search, onApply, timeMode, onTimeMode }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DisplayEvent[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<DisplayEvent | null>(null)
  const hover = useHoverPreview(useMediaQuery('(hover: hover)'))

  async function run() {
    const q = query.trim()
    if (!q) return
    setBusy(true)
    setError('')
    setSelected(null)
    try {
      // 新しい順(最近使った予定ほど上)
      setResults((await search(q)).reverse())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const shown = results?.slice(0, LIMIT) ?? []

  return (
    <div className="field past-search">
      <span>予定の検索(過去の予定をコピーして使う)</span>
      <div className="field-inline">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              run()
            }
          }}
          placeholder="タイトル・メモ・場所で検索"
        />
        <button type="button" className="small ghost" onClick={run} disabled={busy || !query.trim()}>
          {busy ? '検索中…' : '検索'}
        </button>
      </div>
      {error && <span className="error small-text">{error}</span>}

      {results && (
        <>
          <span className="hint small-text">
            {results.length === 0
              ? '見つかりませんでした'
              : `${results.length} 件${results.length > LIMIT ? `(新しい ${LIMIT} 件を表示)` : ''}。使いたい予定をクリックして「適用」を押してください`}
          </span>
          {shown.length > 0 && (
            <ul className="past-results">
              {shown.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`past-row ${selected?.key === item.key ? 'on' : ''}`}
                    onClick={() => {
                      hover.hide()
                      setSelected(item)
                    }}
                    {...hover.handlers(item)}
                  >
                    <span className="bar" style={{ background: item.color }} />
                    <span className="past-when">{describeWhen(item.ev)}</span>
                    <span className="past-title">{item.ev.summary || '(タイトルなし)'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {selected && (
        <div className="past-apply">
          <span className="small-text">
            選択中: <b>{selected.ev.summary || '(タイトルなし)'}</b>({eventRange(selected.ev).start.getFullYear()}年の予定)
          </span>
          <div className="tpl-mode">
            <span className="small-text muted">開始時刻</span>
            <div className="seg">
              <button type="button" className={timeMode === 'template' ? 'on' : ''} onClick={() => onTimeMode?.('template')}>元の予定の時刻</button>
              <button type="button" className={timeMode === 'after' ? 'on' : ''} onClick={() => onTimeMode?.('after')}>最後の予定の後</button>
            </div>
            <button type="button" className="small" onClick={() => onApply(selected, timeMode)}>
              適用
            </button>
          </div>
        </div>
      )}
      {hover.shown && <HoverCard {...hover.shown} />}
    </div>
  )
}
