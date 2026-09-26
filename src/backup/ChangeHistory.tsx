import { useEffect, useState } from 'react'
import { recentChanges, type JournalEntry } from './journal'
import { describeWhen } from '../lib/dates'

const ACTION = { create: '追加', update: '変更', delete: '削除' } as const

/** このブラウザで行った予定の変更の履歴(変更前の内容つき) */
/** onUndo: 元に戻す(確認画面を出し、終わったら done を呼ぶ) */
export default function ChangeHistory({ onUndo }: { onUndo?: (e: JournalEntry, done: () => void) => void }) {
  const [items, setItems] = useState<JournalEntry[] | null>(null)
  const reload = () => recentChanges(100).then(setItems)

  useEffect(() => {
    reload()
  }, [])

  return (
    <section className="card">
      <h2>変更履歴(このブラウザ)</h2>
      <p className="hint">
        このアプリで行った予定の追加・変更・削除の記録です。変更・削除の前の内容も残しています。
        PC で自動バックアップの保存先が設定されていれば、その中の <code>変更履歴</code> フォルダにも保存されます。
      </p>
      {items === null ? (
        <p className="muted">読み込み中…</p>
      ) : items.length === 0 ? (
        <p className="muted">まだ変更はありません</p>
      ) : (
        <ul className="history">
          {items.map((e, i) => {
            const ev = e.after ?? e.before
            return (
              <li key={i}>
                <span className={`hist-action ${e.action}`}>{ACTION[e.action]}</span>
                <span className="hist-body">
                  <b>{ev?.summary || '(タイトルなし)'}</b>
                  {e.movedFrom && <span className="muted">(カレンダーを移動: {e.movedFrom.calendarName} → {e.calendarName})</span>}
                  {e.action === 'update' && e.before?.summary !== e.after?.summary && (
                    <span className="muted">(変更前: {e.before?.summary || '(タイトルなし)'})</span>
                  )}
                  <span className="muted small-text">
                    {ev?.start ? describeWhen(ev) : ''} ／ {e.calendarName} ／ {new Date(e.at).toLocaleString('ja-JP')}
                  </span>
                </span>
                {onUndo && (e.action !== 'update' || e.before) && (
                  <button className="small ghost hist-undo" onClick={() => onUndo(e, reload)}>元に戻す</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
