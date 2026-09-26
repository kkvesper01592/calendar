import { useEffect, useState } from 'react'
import { mdw } from '../lib/dates'

interface Props {
  date: Date
  initial: string
  exists: boolean
  onSave: (text: string) => Promise<void>
  onDelete: () => void
  onCancel: () => void
}

/** 日付メモ(その日に1つ、自由に書けるメモ) */
export default function MemoEditor({ date, initial, exists, onSave, onDelete, onCancel }: Props) {
  const [text, setText] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, saving])

  async function save() {
    if (!text.trim()) return setErr('メモが空です。消す場合は「削除」を押してください')
    setSaving(true)
    try {
      await onSave(text)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal editor" role="dialog" aria-modal="true" aria-label="日付メモ">
        <h2 className="editor-title">📝 {mdw(date)} のメモ</h2>
        <textarea autoFocus rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="この日のメモ" className="memo-text" />
        <p className="hint small-text">1行目がカレンダーに表示されます。</p>
        {err && <p className="error">{err}</p>}
        <div className="modal-actions spread">
          {exists ? <button className="small danger" onClick={onDelete} disabled={saving}>削除</button> : <span />}
          <span>
            <button className="small ghost" onClick={onCancel} disabled={saving}>キャンセル</button>{' '}
            <button className="small" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
          </span>
        </div>
      </div>
    </div>
  )
}
