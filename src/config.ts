// OAuth クライアント ID は公開前提の値(シークレットではない)
export const GOOGLE_CLIENT_ID =
  '751716491065-iv92cgd68fvlpshe34lmg8g7t3ocnf6m.apps.googleusercontent.com'

// 既存カレンダーは読み取りのみ。Google 側の仕様で、この権限では予定の変更・削除は不可能
export const SCOPE_CALENDAR_READONLY = 'https://www.googleapis.com/auth/calendar.readonly'

// このアプリが作ったカレンダー(テスト用・メモ用)の中だけで、予定の作成・変更・削除ができる権限。
// 既存のカレンダーには Google 側で書き込みが拒否される
export const SCOPE_APP_CREATED = 'https://www.googleapis.com/auth/calendar.app.created'

// 既存カレンダーの予定を編集する権限(カレンダー自体の設定変更・削除はできない)。
// アプリ側でも、設定画面で「編集を許可」したカレンダーにしか書き込まない
export const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events'

// アプリが作ったカレンダーの説明欄に入れる目印(どの端末からでも判別できるように)
export const MARK_TEST = '[WebCalendar:test]'
export const MARK_MEMO = '[WebCalendar:memo]'
export const MARK_IMPORT = '[WebCalendar:import]' // 過去のテキストを取り込む専用カレンダー
export const MARK_SETTINGS = '[WebCalendar:settings]' // 設定の保存用(画面のカレンダー一覧には出さない)
