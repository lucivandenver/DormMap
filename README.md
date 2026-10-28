# DormMap

Dormitory and boarding house portal for Bongabong, Oriental Mindoro, built with
XianFire, Node.js/Express, Sequelize MySQL, `.xian` templates and Socket.IO.

## Existing modules

| Account | Modules in the root XianFire app |
| --- | --- |
| Tenant | Dorm search/map, applications and owner offers, tenancy details, rent/payment history, maintenance requests, messages, documents, profile |
| Boarding house owner | Multiple establishments, rooms, tenants, applications, rent records, inquiries, messages, gallery, permits, profile/documents |
| Barangay | Owner application review, boarding house/permit records, BPLO data requests and submissions, masterlist exports, messages, announcements |
| Super admin / BPLO | Owner review, barangays/institutions, permits and renewals, consolidated submissions, reports, audit logs, settings |

Optional integrations include Google login, Gmail SMTP, PayMongo and Dormigo/Gemini.
Their live behavior depends on valid provider credentials and account setup.

## This review adds

- Account-based saved dorms and a comparison table for two or three dorms.
- Budget, availability and saved-only filters, plus lowest-rent sorting.
- Consistent approved-owner visibility, accurate available-room counts, and stable
  map selection when filtering. Unknown prices/locations are not invented.
- Aiven MySQL custom port and verified TLS/CA configuration.
- MySQL-backed login sessions, HTTPS cookies and Render proxy support.
- Non-destructive schema bootstrap, health check, graceful shutdown and disk uploads.
- Production guards for demo payment routes, signed webhook validation, and private
  WebSocket rooms based on the authenticated session.

## Local quick start

Install Node.js 24 and start MySQL. Copy `.env.example` to `.env`, configure the
database, and set a random `SESSION_SECRET` to keep sessions valid after restarts.

```bash
npm ci --omit=dev
# Existing database:
npm run migrate
# Or create a fresh LOCAL database:
# npm run migrate -- --create-database
npm start
```

Open http://localhost:3000. Use `npm run admin:create` to create an admin account
without publishing a default password. To use Nodemon, install development
dependencies with `npm ci`, then `npm run xian`.

## Deployment and review

Follow [the Render + Aiven + VS Code guide](docs/DEPLOY_RENDER_AIVEN.md).
Deploy from the **repository root**, with build `npm ci --omit=dev` and start
`npm run start:render`. `npm run build` builds the optional Electron desktop app.
The separate `backend/` folder is not the entry point of these dashboards.

`render.yaml` is an optional **paid** service/disk blueprint with auto-deploy off.
It does not create infrastructure by itself. Free Render instances cannot keep
the current local uploads across restarts/redeploys.

For a Free service, omit `UPLOAD_DIR` or set `./public/uploads`. `/var/data/uploads`
requires an attached writable disk. If a configured folder is denied/read-only,
startup falls back to local uploads with a warning; those files are temporary.
Set `UPLOAD_DIR_STRICT=true` to require the configured disk instead. The paid
blueprint enables strict mode.

The migration command creates missing tables/columns without dropping tables,
changing existing column types or deleting unknown legacy columns. It uses a
database advisory lock to serialize concurrent bootstrap runs. Back up before
schema updates; future column renames/type changes require explicit migrations.

Source changes stay local until reviewed and explicitly approved for a push.
The legacy AWS workflow is now manual so a later push does not deploy to EC2.

## Checks

```bash
npm run check
npm test
```

Integration checks need a disposable MySQL-compatible database whose name ends
in `_test`, with `RUN_DB_TESTS=true`. See the guide for PowerShell instructions.
GitHub Actions also defines these checks against MySQL 8.4; that workflow only
runs after these files are pushed.

## XianFire commands

| Command | Purpose |
| --- | --- |
| `npm start` / `npm run xian-start` | Run the web app |
| `npm run xian` | Develop with Nodemon |
| `npm run migrate` | Add missing schema safely |
| `npm run admin:create` | Create a super admin interactively |
| `npm run create:model Name` | Generate a model |
| `npm run create:controller Name` | Generate a controller |
| `npm run xianca` | Run the optional Electron app |
| `npm run xian-build` | Build the optional desktop app |

XianFire copyright notices and the framework's MIT license notices are retained
in the source files.
