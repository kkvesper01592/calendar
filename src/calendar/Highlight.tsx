import { splitByMatches } from '../lib/highlight'

/** 検索のキーワードに色を付けて表示する(words が空ならそのまま) */
export default function Highlight({ text, words }: { text: string; words?: string[] }) {
  if (!words?.length) return <>{text}</>
  return (
    <>
      {splitByMatches(text, words).map((p, i) => (p.hit ? <mark key={i} className="hit">{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  )
}
