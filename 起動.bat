@echo off
chcp 65001 >nul
title WebCalendar (この画面を閉じるとアプリも止まります)
cd /d "%~dp0"
echo WebCalendar を起動しています...
echo ブラウザが自動で開きます。使い終わったら、この黒い画面を閉じてください。
echo.
call npm run dev -- --open /calendar/
echo.
echo 起動できませんでした。すでに別の画面で起動している場合は、そちらをお使いください。
pause