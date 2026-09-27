import { useEffect } from 'react'
import { describeWhen, eventRange, startOfDay } from '../lib/dates'
import type { DisplayEvent } from './useRangeEvents'
import { eventMapUrl, mapSearchUrl } from '../lib/maps'
import { plainText } from '../lib/highlight'
import Highlight from './Highlight'

// http(s) のリンクだけをリンクにする(それ以外は文字として表示)。words があれば検索語に色を付ける
function Linkified({ text, words }: { text: string; words?: string[] }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a>
        ) : (
          <span key={i}>
            <Highlight text={p} words={words} />
          </span>
        ),
      )}
    </>
  )
}

/** 予定の中身(ポップアップと検索のプレビューで共通)。words を渡すと検索語に色を付ける */
export function EventBody({ item, words }: { item: DisplayEvent; words?: string[] }) {
  const { ev, calendar, color } = item
  const mapUrl = eventMapUrl(ev)
  return (
    <>
      <h2 className="modal-title">
        <Highlight text={ev.summary || '(タイトルなし)'} words={words} />
      </h2>
      <p className="modal-when">{describeWhen(ev)}</p>
      {(ev.recurringEventId || ev.recurrence) && <p className="badge">繰り返しの予定</p>}
      {(ev.location || mapUrl) && (
        <p className="modal-row">
          <span className="label">場所</span>
          <span>
            {/* 地図のリンクが登録されていればその場所へ、無ければ住所で地図を検索 */}
            <a href={mapUrl ?? mapSearchUrl(ev.location!)} target="_blank" rel="noopener noreferrer">
              📍 {ev.location ? <Highlight text={ev.location} words={words} /> : '地図を開く'}
            </a>
            {mapUrl && <span className="muted small-text"> (登録した地図)</span>}
          </span>
        </p>
      )}
      {ev.description && (
        <div className="modal-row">
          <span className="label">メモ</span>
          <div className="modal-desc">
            {/* Google の説明欄は HTML を含むことがあるので、タグを外して文字だけ表示する(スクリプトは実行されない) */}
            <Linkified text={plainText(ev.description)} words={words} />
          </div>
        </div>
      )}
      <p className="modal-row">
        <span className="label">カレンダー</span>
        <span>
          <span className="swatch" style={{ background: color }} /> {calendar.summaryOverride || calendar.summary}
        </span>
      </p>
    </>
  )
}

interface Props {
  item: DisplayEvent
  onClose: () => void
  onShowDay?: (d: Date) => void
  onEdit?: () => void // 書き込めるカレンダーの予定のときだけ
  onDelete?: () => void
  onSaveTemplate?: () => void
  words?: string[] // 検索結果から開いたときの検索語(色を付ける)
  readOnlyNote?: string // 編集できない理由(オフライン中など)
}

/** 1件の予定だけを表示するポップアップ */
export default function EventDetail({ item, onClose, onShowDay, onEdit, onDelete, onSaveTemplate, words, readOnlyNote }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="予定の詳細" onClick={(e) => e.stopPropagation()}>
        <div className="modal-bar" style={{ background: item.color }} />
        <button className="modal-close" onClick={onClose} aria-label="閉じる">×</button>
        <EventBody item={item} words={words} />
        <div className="modal-actions spread">
          <span>
            {onShowDay && (
              <button className="small ghost" onClick={() => onShowDay(startOfDay(eventRange(item.ev).start))}>
                この日の予定を表示
              </button>
            )}{' '}
            {onSaveTemplate && (
              <button className="small ghost" onClick={onSaveTemplate}>
                テンプレートに保存
              </button>
            )}
          </span>
          {onEdit ? (
            <span>
              {onDelete && <button className="small danger" onClick={onDelete}>削除</button>}{' '}
              <button className="small" onClick={onEdit}>編集</button>
            </span>
          ) : (
            <span className="muted small-text">{readOnlyNote ?? '閲覧専用のカレンダー'}</span>
          )}
        </div>
      </div>
    </div>
  )
}
