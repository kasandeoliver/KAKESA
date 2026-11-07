# KAKESA Meeting Management

KAKESA is a responsive HTML/CSS/JavaScript frontend with a Node.js/Express API and PostgreSQL persistence. The current foundation includes secure registration and login, server-side sessions, role-aware member administration, meeting scheduling, invitations, attendance, minutes drafts and approval, plus indexed and paginated database access.

## Requirements

- Node.js 20 or newer
- PostgreSQL 15 or newer
- npm

XAMPP is not needed for this architecture. The Express application serves the website and API on the same origin. Do not connect browser code directly to PostgreSQL.

## Local setup on Windows

1. Start the PostgreSQL Windows service.
2. In pgAdmin, create a database named `kakesa_db` owned by a database user named `kakesa_app`. The user must be able to create tables in the database's `public` schema. If using SQL, create the role and database as separate statements:

   ```sql
   CREATE ROLE kakesa_app LOGIN PASSWORD 'choose-a-local-password';
   CREATE DATABASE kakesa_db OWNER kakesa_app;
   ```

3. This workspace already has a `.env` file. Add/merge the `DATABASE_URL` setting from `.env.example` into that existing file and set a long `SESSION_SECRET`; do not overwrite your `.env` or share/commit it.
4. Install packages and start the application:

   ```powershell
   npm install
   npm run dev
   ```

5. On first startup, KAKESA creates the tables and indexes from `database/schema.sql`. Open `http://localhost:3000` and check `http://localhost:3000/api/health`.
6. Register your account, then assign the first administrator role from the project directory:

   ```powershell
   npm run admin:promote -- your-email@example.com
   ```

Run the application smoke tests with `npm test`.

The database URL should use the password you chose for `kakesa_app`, for example `postgresql://kakesa_app:your-password@localhost:5432/kakesa_db`. If the password contains reserved URL characters, percent-encode them. Never put the URL in frontend JavaScript or commit it.

If PostgreSQL is not configured, the website still starts so you can inspect the frontend; database-backed APIs report `503` and explain that `DATABASE_URL` is missing or unavailable.

## Roles and application areas

- **Administrator:** account roles and status, members, meetings and records.
- **Chairperson:** lead meetings and manage meeting status.
- **Secretary:** prepare meeting records and minutes.
- **Member:** access meetings they are invited to and record attendance.

Public registration always creates a member. Elevated roles can only be assigned by an administrator or the local administrator-promotion command. Meetings, attendance, agenda items, minutes, decisions, action items, notifications and audit records have separate relational tables.

## API foundation

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/users` (administrator, chairperson or secretary; paginated search)
- `PATCH /api/users/:id/role` and `PATCH /api/users/:id/status` (administrator only)
- `GET /api/meetings`, `GET /api/meetings/summary`, `POST /api/meetings`, `GET /api/meetings/:id`
- `PATCH /api/meetings/:id/status`, `POST /api/meetings/:id/attendance`
- `PATCH /api/meetings/:id/invitation`, `POST /api/meetings/:id/decisions`
- `GET /api/meetings/:id/minutes`, `PUT /api/meetings/:id/minutes`
- `POST /api/meetings/:id/action-items`, `GET /api/notifications`
- `GET /api/health`

Passwords are bcrypt-hashed, SQL is parameterized, sessions use HTTP-only same-site cookies and the PostgreSQL-backed session store, mutating API calls reject cross-origin requests, and login/registration are rate-limited in each app process. Production deployments must set `NODE_ENV=production`, `DATABASE_URL`, a unique long `SESSION_SECRET`, HTTPS, and any required proxy configuration. Use a shared rate-limit store if deploying multiple instances.

## Capacity and performance

The schema uses independent tables and indexes rather than embedding all members in one meeting row. Directory and meeting endpoints paginate results; the PostgreSQL connection pool is bounded (`DB_POOL_MAX`, default 10). These are sound foundations for 1,000+ registered accounts, but they do not prove a specific concurrent-user capacity. Measure with representative data and load tests on the actual database and hosting plan before setting a production capacity target. Tune the pool together with PostgreSQL connection limits; use a pooler when deploying multiple application instances.

The current version does not yet include distributed WebSocket timers/notifications, WebRTC media infrastructure, automatic transcription, email verification/password recovery, or a PDF-generation service. Minutes can be printed or saved as PDF through the browser. Real-time multi-user media requires a separate signaling/media service and load testing; it is not supplied by PostgreSQL or by a static page.

## Deployment

Deploy the Express server and PostgreSQL database to hosting that supports both long-running Node.js processes and PostgreSQL. Configure environment variables in the hosting dashboard, require HTTPS, restrict database network access, and run backups. For multi-instance deployments, keep sessions in PostgreSQL (or another shared session store) and avoid process-local state. Apply the schema before serving traffic if the deployment platform does not run `server.js` initialization.

### Vercel

The root `index.js` exports the Express application for Vercel's zero-configuration Express support. Set the Vercel project **Root Directory** to the repository root and deploy the `main` branch. Vercel serves files under `public/` as static assets; the Express `express.static()` middleware is therefore only enabled for local development. The explicit `/` route serves `public/index.html` when the request reaches the Express function.

Add `DATABASE_URL` and a unique `SESSION_SECRET` of at least 32 characters under **Project Settings → Environment Variables** for Production (and Preview if used), then redeploy. Without them the homepage remains available, `/api/health` reports the missing database, and account/meeting APIs return `503` rather than failing the website deployment.

## Proposed Business Model Canvas

| Building block | KAKESA proposal |
|---|---|
| Key partners | Cloud/database providers, video and transcription providers, institutions |
| Key activities | Software development, meeting workflows, support, security and maintenance |
| Value proposition | Centralized scheduling, attendance, decisions and reliable meeting records |
| Customer relationships | Onboarding, training, tutorials, online support and feedback |
| Customer segments | Schools, universities, companies, government bodies, NGOs and associations |
| Key resources | Application, developers, PostgreSQL/cloud infrastructure and domain expertise |
| Channels | Website, institutional partnerships, direct demonstrations and digital marketing |
| Cost structure | Development, hosting, storage, media/transcription services, support and security |
| Revenue streams | Proposed free/basic tier, organizational subscriptions, enterprise setup and training |

Pricing and revenue assumptions need validation with prospective customers before launch.
