import { useEffect, useState } from 'react'
import { hhmm, mdw } from '../lib/dates'
import { describeTemplate, type Template, type TemplateTimeMode } from './templates'
import { HoverCard, useHoverPreview } from '../calendar/HoverPreview'
import type { DisplayEvent } from '../calendar/useRangeEvents'
import { useMediaQuery } from '../lib/useMediaQuery'

interface Props {
  date: Date
  templates: Template[]
  onPick: (t: Template, stamp: boolean) => void
  onOpenEditor: () => void
  onCancel: () => void
  toPreview: (t: Template) => DisplayEvent // カーソルを合わせたときのカード用
  timeMode: TemplateTimeMode
  onTimeMode: (m: TemplateTimeMode) => void
  afterTime?: Date // その日の最後の予定の終了時刻(無ければ undefined)
}

/** テンプレートを選んで、その日の予定を作る(編集画面で確認してから保存) */
export default function QuickAdd({ date, templates, onPick, onOpenEditor, onCancel, toPreview, timeMode, onTimeMode, afterTime }: Props) {
  const [stamp, setStamp] = useState(false)
  const hover = useHoverPreview(useMediaQuery('(hover: hover)'))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal quick" role="dialog" aria-modal="true" aria-label="テンプレートから登録" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onCancel} aria-label="閉じる">×</button>
        <h2 className="editor-title">{mdw(date)} に追加</h2>
        <div className="quick-mode">
          <span className="quick-h">開始時刻</span>
          <div className="seg">
            <button className={timeMode === 'template' ? 'on' : ''} onClick={() => onTimeMode('template')}>テンプレートの時刻</button>
            <button className={timeMode === 'after' ? 'on' : ''} onClick={() => onTimeMode('after')}>最後の予定の後</button>
          </div>
          {timeMode === 'after' && (
            <span className="hint small-text">
              {afterTime ? `${hhmm(afterTime)} から(長さはテンプレートのまま)` : 'この日は予定が無いので、テンプレートの時刻を使います'}
            </span>
          )}
        </div>
        <h3 className="quick-h">テンプレート</h3>
        {templates.length ? (
          <ul className="rows">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  className={`row ${hover.shown?.item.key === t.id ? 'hovered' : ''}`}
                  onClick={() => {
                    hover.hide()
                    onPick(t, stamp)
                  }}
                  {...hover.handlers(toPreview(t))}
                >
                  <span className="row-time">{describeTemplate(t, timeMode === 'after' && !t.allDay ? afterTime : undefined)}</span>
                  <span className="row-title">{t.title || '(タイトルなし)'}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint small-text">まだありません。予定の詳細の「テンプレートに保存」で作れます。</p>
        )}
        <label className="check">
          <input type="checkbox" checked={stamp} onChange={(e) => setStamp(e.target.checked)} />
          スタンプモード(編集画面を出さずに、押した日へ次々に登録する)
        </label>
        <div className="modal-actions spread">
          <span className="hint small-text">{stamp ? '選ぶとすぐ登録され、続けて他の日も押せます' : '選ぶと、内容が入った編集画面が開きます'}</span>
          <button className="small ghost" onClick={onOpenEditor}>空の予定を追加</button>
        </div>
      </div>
      {hover.shown && <HoverCard {...hover.shown} />}
    </div>
  )
}
