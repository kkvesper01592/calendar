import { useEffect } from 'react'

export interface Choice {
  label: string
  danger?: boolean
  action: () => void
}

/** 確認ダイアログ(削除の確認、繰り返し予定の範囲の選択など) */
export default function ConfirmDialog({ title, message, choices, onCancel }: { title: string; message?: string; choices: Choice[]; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="editor-title">{title}</h2>
        {message && <p>{message}</p>}
        <div className="confirm-actions">
          {choices.map((c) => (
            <button key={c.label} className={`small ${c.danger ? 'danger' : ''}`} onClick={c.action}>
              {c.label}
            </button>
          ))}
          <button className="small ghost" onClick={onCancel}>キャンセル</button>
        </div>
      </div>
    </div>
  )
}
