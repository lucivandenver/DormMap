@echo off
echo ========================================================
echo        DORMAP - Push to GitHub & AWS Auto-Deploy
echo ========================================================
echo.

set /p msg="Enter commit description (Press Enter for default): "
if "%msg%"=="" set msg=Update DorMap system files

echo.
echo [1/3] Staging all files (excluding node_modules and .env)...
git add .

echo.
echo [2/3] Committing changes...
git commit -m "%msg%"

echo.
echo [3/3] Pushing to GitHub main branch...
git push -u origin main

echo.
echo ========================================================
echo  All files successfully pushed to GitHub!
echo ========================================================
pause
