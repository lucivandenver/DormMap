@echo off
echo DormMap changes require review before a GitHub push.
echo This helper does not stage, commit, push, or deploy files.
git status --short
echo Review with git diff or the VS Code Source Control panel.
pause
