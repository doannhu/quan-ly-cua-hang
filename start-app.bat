@echo off
rem Start the store app: backend and frontend, each in its own window.
rem Double-click this file, or run it from cmd. Close a window (or press Ctrl+C in it) to stop that part.

set "APP=C:\Users\HP\Downloads\quan-ly-cua-hang-v2\quan-ly-cua-hang"

rem ---- backend ----
start "Backend" cmd /k "cd /d "%APP%\backend" && npm ci --omit=dev && npm run start:env"

rem ---- frontend (build, then serve on port 8080 for the whole network) ----
start "Frontend" cmd /k "cd /d "%APP%\frontend" && npm ci && npm run build && npx vite preview --host --port 8080"

echo Da mo 2 cua so: Backend va Frontend.
echo Mo app tai http://localhost:8080 (may khac trong mang: http://IP-cua-may-nay:8080)
