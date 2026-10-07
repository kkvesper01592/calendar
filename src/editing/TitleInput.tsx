import { useMemo, useState } from 'react'
import { suggestTitles, type TitleEntry } from '../lib/titleIndex'
import Highlight from '../calendar/Highlight'
import { searchWords } from '../lib/highlight'

interface Props {
  value: string
  onChange: (v: string) => void
  index: TitleEntry[] // 過去に入力したタイトルの一覧
  placeholder?: string
  autoFocus?: boolean
}

/**
 * タイトルの入力欄。1文字入力するたびに、過去に入力したタイトルの候補をドロップダウンで出し、
 * クリック(または ↑↓ と Enter)で入れられる。日本語の変換中の Enter では選ばない
 */
export default function TitleInput({ value, onChange, index, placeholder, autoFocus }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const list = useMemo(() => (open ? suggestTitles(index, value) : []), [open, index, value])

  const pick = (t: string) => {
    onChange(t)
    setOpen(false)
    setActive(-1)
  }

  return (
    <div className="title-input">
      <input
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={list.length > 0}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        // 候補をクリックしてから閉じるよう、少し待つ
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!list.length || e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => (a + 1) % list.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a <= 0 ? list.length - 1 : a - 1))
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault()
            pick(list[active].title)
          } else if (e.key === 'Escape') {
            e.stopPropagation() // 画面全体の「閉じる」にしない
            setOpen(false)
          }
        }}
      />
      {list.length > 0 && (
        <ul className="title-suggest" role="listbox">
          {list.map((t, i) => (
            <li
              key={t.title}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              // クリックで入力欄からフォーカスが外れる前に選ぶ
              onMouseDown={(e) => {
                e.preventDefault()
                pick(t.title)
              }}
              onMouseEnter={() => setActive(i)}
            >
              {/* タイトルの入力なので、候補もタイトルだけを出す */}
              <span className="title-suggest-text">
                <Highlight text={t.title} words={searchWords(value)} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
