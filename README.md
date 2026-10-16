# ISDMS: Integrated Student Database Management System
Developer: TD-X Lab. © TD-X Lab 2026. All Rights Reserved.

## Phase 01 quick start
Requirements: Node.js 18+, MySQL 8.
```
cp .env.example .env        # fill DB_USER, DB_PASSWORD, DB_NAME
npm run install:all
npm run migrate             # creates schema_migrations, universities, system_settings
npm run dev:backend         # http://localhost:5000/api/v1/health
npm run dev:frontend        # http://localhost:5173
npm test
```
See PROJECT_STATE.md for the current state of the build.
