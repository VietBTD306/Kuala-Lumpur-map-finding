@echo off
title Kuala Lumpur Metro Pathfinding App
echo ==========================================================
echo    DANG KHOI DONG HE THONG DUONG SAT DO THI KUALA LUMPUR
echo ==========================================================
echo.
echo [1/2] Di chuyen vao thu muc Backend...
cd /d "%~dp0Backend"
echo [2/2] Chay server FastAPI...
echo.
echo *Luu y: Trinh duyet se tu dong mo trang web sau 2 giay.
echo *De tat ung dung: Dong cua so CMD nay.
echo.
python -m app.main
pause
