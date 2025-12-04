SquadZone full-stack prototype
==============================

How to run locally (node required)
1. Unzip this archive.
2. In the project folder, install dependencies:
   npm install
3. Start the server:
   npm start
4. Open http://localhost:3000

Features included:
- Registration / login with avatar upload
- Session-based auth (cookie)
- Create posts with text + image (uploads stored in /uploads)
- Comments, likes (basic)
- Simple friends table (accept immediate)
- Simple Socket.IO chat (broadcast)
- SQLite DB: squadzone.db created automatically

Limitations and security notes:
- Sessions stored in memory (not suitable for production). Use a persistent session store.
- No email verification.
- No rate limiting, CSRF protection, strong input validation, or production hardening.
- File uploads are saved to /uploads without virus scanning.
- For production, use HTTPS, hardened headers, and proper auth flows.

Next steps I can implement for you:
- Real-time 1:1 chat with rooms and user presence
- Friend requests flow with accept/reject
- Reactions (multiple types), post privacy, share
- Pagination, search, notifications, admin moderation panel

Docker instructions
-------------------
Build and run with Docker:
1. docker build -t squadzone:latest .
2. docker run -p 3000:3000 -v $(pwd)/uploads:/app/uploads -v $(pwd)/squadzone.db:/app/squadzone.db squadzone:latest

Or using docker-compose:
1. docker-compose up -d --build
2. Open http://localhost:3000

Notes:
- The container uses SQLite file at /app/squadzone.db which is mounted from the host for persistence.
- Uploaded files are stored in ./uploads on the host.
- For production, use a persistent DB (Postgres) and a proper session store.
