# DormMap: Render + Aiven MySQL + VS Code

Render/Aiven deployment support and the upload-storage fix are already on `main`.
The live landing-page and approval changes are prepared separately in `codex/live-landing-approvals` for review.

## 1. Ano talaga ang ide-deploy?

Node.js/Express ang XianFire app na ito, may Sequelize MySQL at `.xian` views.
Hindi kailangan ng PHP server para patakbuhin ito. Ang phpMyAdmin ay pang-manage
ng MySQL; ang Aiven ay hosting ng MySQL server. Compatible pa rin ang MySQL data,
pero kailangan itong i-export/import kung gusto mong dalhin ang existing records.

Gamitin ang **root folder** ng repo: dito ang `index.js` at main `package.json`.
May hiwalay na `backend/` implementation sa repo; hindi iyon ang server ng
kasalukuyang XianFire dashboards. Ang `npm run build` ay Electron desktop build,
kaya hindi ito ang Render build command.

## 2. Review muna, walang push

Sa VS Code terminal / PowerShell, i-clone kung wala ka pang local copy:

```powershell
git clone https://github.com/lucivandenver/DormMap.git
cd DormMap
git switch -c review/render-aiven-shortlist 5d3aa1ac81330ec08dcdac0d52fc2d841a867906
code .
```

I-download ang `DormMap-review.patch` na kasama sa review package. Sa loob ng
repo, gamitin ang actual path kung saan mo ito na-save:

```powershell
git apply --check "C:/Users/YOUR_NAME/Downloads/DormMap-review.patch"
git apply "C:/Users/YOUR_NAME/Downloads/DormMap-review.patch"
git diff --stat
```

Kung may existing local copy ka, i-save muna ang sarili mong work. `git fetch origin`
ang pangkuha ng remote updates; gumawa ng review branch mula sa base commit sa
itaas, saka i-apply ang patch. Kapag may conflict sa `--check`, huwag i-force.

Sa Source Control panel ng VS Code makikita ang buong diff. Ang bagong files ay
under Untracked Changes. Puwede ring i-extract ang `DormMap-review-source.zip` sa
bagong folder para makita ang buong updated source. Walang `.env`, database data,
`node_modules`, o Git credentials sa package.

Para sa GitHub browser IDE: ang `github.dev` ay editor; hindi ito local Node/MySQL
runtime. Gumamit ng **GitHub Codespaces** kung gusto ng browser editor na may
terminal: Code → Codespaces → Create codespace, gumawa ng review branch, i-upload
ang patch sa Explorer, at patakbuhin ang `git apply --check` / `git apply` doon.
Walang kailangang push para makita ang diff sa sarili mong Codespace. Posibleng
may Codespaces usage charge depende sa account allowance. Hindi pa awtomatikong
makikita sa github.com/main ang unpushed changes sa workspace na ito.

## 3. Patakbuhin sa localhost gamit ang VS Code

Requirements: Node.js 24, Git, at running MySQL mula sa Laragon/XAMPP/MySQL Server.
Kung may data ka na, mag-export muna ng backup sa phpMyAdmin.

Sa PowerShell:

```powershell
Copy-Item .env.example .env
npm ci --omit=dev
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

I-paste ang generated random string sa `SESSION_SECRET` ng `.env`. Itama rin ang
DB name, host, port, user at password sa sarili mong phpMyAdmin/MySQL setup:

```env
NODE_ENV=development
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=DorMap
DB_USER=root
DB_PASSWORD=
DB_SSL=false
SESSION_SECRET=PASTE_YOUR_RANDOM_STRING_HERE
PORT=3000
APP_URL=http://localhost:3000
APP_BASE_URL=http://localhost:3000
```

Kung existing na ang database:

```powershell
npm run migrate
npm start
```

Kung bagong local database pa lang:

```powershell
npm run migrate -- --create-database
npm start
```

Buksan ang **http://localhost:3000**. I-check din ang
**http://localhost:3000/healthz**, na dapat magbalik ng `{"status":"ok"}`.
Kung kailangan mo ng bagong admin, ihinto muna ang server o magbukas ng pangalawang
terminal at gamitin ang `npm run admin:create`. May prompt para sa pangalan,
email at password. Hindi nito pinapalitan ang existing account.

Optional auto-reload: `npm ci` para maisama ang development dependencies, tapos
`npm run xian`. Ang regular na `npm start` ay puwedeng gamitin kahit hindi ka
mag-install ng Electron at Nodemon.

Para sa `.xian` syntax highlighting sa VS Code settings:

```json
{ "files.associations": { "*.xian": "html" } }
```

Hindi ko direktang na-open ang VS Code o localhost sa sarili mong computer.
Ang commands sa itaas ang magpapatakbo roon ng local copy mo.

## 4. Gumawa ng Aiven MySQL database

1. Sa Aiven Console, gumawa ng **MySQL** service. Pumili ng available region na
   malapit sa Render service at plan na pasok sa budget; tingnan ang kasalukuyang
   limits at billing bago i-create.
2. Hintaying running ang service. Sa Overview / Connection information, kunin ang
   host, **actual port**, database name, username at password. Huwag ipagpalagay na
   `3306` ang port; maaaring iba ang ibigay ng Aiven.
3. Gamitin ang existing `defaultdb` o gumawa ng `DorMap` sa Databases section.
   Eksaktong database name ang ilalagay sa `DB_NAME`.
4. I-download ang **CA certificate**. Gagamitin ito para ma-verify ang SSL connection.
5. Kung naka-restrict ang allowed IPs ng Aiven service, payagan ang outbound IP
   ranges ng Render service at ang development IP mo kung kailangan. Kunin ang
   actual ranges sa Render dashboard; huwag gumamit ng inbound website IP bilang
   database allowlist.

Sa local `.env` para i-check ang Aiven connection:

```env
DB_HOST=YOUR_AIVEN_HOST
DB_PORT=YOUR_AIVEN_PORT
DB_NAME=defaultdb
DB_USER=avnadmin
DB_PASSWORD=YOUR_AIVEN_PASSWORD
DB_SSL=true
DB_SSL_CA_PATH=./certs/ca.pem
```

Ilagay ang downloaded CA sa `certs/ca.pem`, pagkatapos `npm run migrate`. Huwag
i-commit ang `.env` o credentials. Para sa araw-araw na development, gumamit ng
hiwalay na local/dev database para hindi mabago ang live records habang nagte-test.

## 5. Ilipat ang existing phpMyAdmin/MySQL records

Hindi awtomatikong sumusunod sa Git push ang local database data o uploaded files.

1. Sa phpMyAdmin, piliin ang existing DormMap database → Export → SQL. Kailangan
   ng **structure + data**, kasama ang original IDs, dahil may related records.
2. Mag-restore muna sa **bagong empty Aiven database**, bago patakbuhin ang app.
   I-review ang export: dapat tumukoy ito sa target database at hindi may
   `CREATE DATABASE` / `USE` para sa ibang local database. I-check ang table name
   casing, lalo na kung galing Windows papuntang Linux.
3. Puwedeng gumamit ng MySQL Workbench o DBeaver na may Aiven host/port at CA. Kung
   Oracle MySQL client ang naka-install, puwedeng sa **cmd.exe** ito:

```bat
mysql --host=YOUR_AIVEN_HOST --port=YOUR_AIVEN_PORT --user=avnadmin --password --ssl-mode=VERIFY_CA --ssl-ca="C:/path/ca.pem" defaultdb < "C:/path/DormMap.sql"
```

Ipo-prompt ang password; hindi kailangang ilagay sa command. Ang `< file.sql`
syntax ay para sa cmd.exe/Bash, hindi PowerShell. Para sa MariaDB client, gumamit
ng supported TLS options nito o GUI client; iba ang SSL command flags nito.

Kung mag-export gamit ang Oracle `mysqldump`, karaniwang gamit:

```bat
mysqldump --host=127.0.0.1 --port=3306 --user=root --password --single-transaction --no-tablespaces --set-gtid-purged=OFF DorMap > DormMap.sql
```

4. Pagkatapos ma-import: `npm run migrate` gamit ang Aiven settings. Ang bagong
   command ay gumagawa ng missing tables at missing columns; hindi nagda-drop o
   nagre-recreate ng existing tables. Hindi rin nito binabago ang existing column
   types o nagre-rename ng columns. Mag-backup pa rin bago anumang schema change.
5. I-transfer din ang **local `public/uploads/` files na referenced sa records**.
   Ang Aiven ay nagtatago ng file URLs, hindi ng actual pictures/documents.
   Existing files na committed na sa repo ay kinokopya ng app papunta sa disk
   kapag first start, at hindi nito ino-overwrite ang mas bagong disk files.
   Para sa files na nasa computer mo lang, gamitin ang Render SSH/SCP instructions
   para ilagay ang mga ito sa `/var/data/uploads` sa disk-backed service.

Kung may `DEFINER` / privilege / collation error sa import, i-adjust ang export
ayon sa target MySQL version/permissions. Huwag i-import ang buong `mysql` system
database mula sa XAMPP/Laragon.

## 6. Render Web Service setup

Gawin ito **pagkatapos ma-review at ma-approve ang source changes sa GitHub**.
Ang current GitHub `main` ay wala pa sa setup na inilalarawan dito.

1. Render Dashboard → New → **Web Service**.
2. Piliin ang **Git Provider → GitHub** at `lucivandenver/DormMap`. Ang public Git
   URL option ay hindi kapareho ng connected Git provider para sa auto-deploy.
3. Settings:

| Setting | Value |
| --- | --- |
| Branch | `main`, kapag approved na ang changes |
| Root Directory | Blank / repository root |
| Runtime / Language | Node |
| Region | Singapore, kung available |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm run start:render` |
| Health Check Path | `/healthz` |
| Auto-Deploy | Off muna para ikaw ang may control sa releases |

`start:render` = `npm run migrate && npm start`; kapag pumalya ang migration,
hindi itutuloy ang bagong server. Walang interactive prompt ang migration.
Render ang nagbibigay ng `PORT`; hindi kailangan ng hard-coded `3000` doon.

4. Para sa current file uploads ng system, gumamit ng **paid Web Service +
   persistent disk**. Mount path: `/var/data`; app upload directory:
   `/var/data/uploads`. May brief downtime ang redeploy kapag may attached disk,
   at isang service instance lang ang makakagamit ng disk.
5. Ilagay ang environment variables sa Render, hindi sa GitHub source:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24` |
| `DB_HOST` | Actual Aiven hostname |
| `DB_PORT` | Actual Aiven port |
| `DB_NAME` | `defaultdb` o exact target database |
| `DB_USER` | Aiven service username |
| `DB_PASSWORD` | Aiven service password |
| `DB_SSL` | `true` |
| `DB_SSL_CA` | Buong CA certificate contents, kasama ang BEGIN/END lines |
| `SESSION_SECRET` | Random string, at least 32 characters; panatilihin sa redeploys |
| `UPLOAD_DIR` | `/var/data/uploads` |
| `APP_URL` | `https://YOUR-SERVICE.onrender.com` |
| `APP_BASE_URL` | Same actual Render URL |

Alternative sa `DB_SSL_CA`: gumawa ng Render Secret File na `ca.pem` at set
`DB_SSL_CA_PATH=/etc/secrets/ca.pem`. Pumili ng isa; unahin ng app ang inline
`DB_SSL_CA` kung parehong may value. Huwag i-disable ang certificate verification.

6. Create Web Service. Hintaying healthy at buksan ang actual URL. I-check ang
   `/healthz`, login, dashboards, dorm search, uploads at save/unsave.
7. Optional: `render.yaml` ang prepared blueprint para sa same paid setup, may
   generated session secret at manual deployment setting. Review muna ang plan at
   costs; hindi kusang gumagawa ng Render service ang file na ito.

**Kung Render Free muna:** alisin ang `UPLOAD_DIR` override, o gamitin ang
`UPLOAD_DIR=./public/uploads`. Huwag gamitin ang `/var/data/uploads` kung walang
persistent disk na naka-mount sa `/var/data`. Puwedeng i-demo ang app gamit ang parehong build/start
commands, pero huwag umasa sa local uploads: nawawala ang bagong files sa restart,
redeploy o spin-down. Hindi supported ang persistent disk sa Free. Kailangan ng
external object storage integration bago iyon gamitin para sa durable uploads;
hindi pa kasama ang S3/Cloudinary integration sa review na ito. Relational data
at sessions ay nasa Aiven. Blocked din ang SMTP ports 465/587 sa Free, kaya ang
current Gmail SMTP reset/verification emails ay nangangailangan ng paid compute
o ibang email transport implementation.

Kung naiwan ang `/var/data/uploads` at nagbalik iyon ng `EACCES`, `EPERM` o `EROFS`,
ang app ay gagamit ng writable `public/uploads` fallback at maglalabas ng warning.
Parehong folder ang ginagamit ng uploads at downloads. Temporary storage pa rin
iyon; hindi nito ginagawang persistent ang Free plan. Sa paid disk setup, puwedeng
set `UPLOAD_DIR_STRICT=true` para huminto ang startup kung hindi writable ang disk,
sa halip na gumamit ng temporary fallback. Enabled ito sa paid blueprint.

## 7. Optional Google login, email, payments at Dormigo

- Google: set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, at
  `GOOGLE_CALLBACK_URL=https://YOUR-SERVICE.onrender.com/auth/google/callback`.
  Idagdag ang exact callback URI sa Google OAuth Console; hiwalay ang localhost URI.
- Gmail SMTP: set `GMAIL_USER`, `GMAIL_PASS` gamit ang Gmail App Password, at
  `EMAIL_FROM`. Hindi ito ang normal Gmail password.
- PayMongo: set valid provider keys at `PAYMONGO_WEBHOOK_SECRET_KEY`; webhook URL:
  `https://YOUR-SERVICE.onrender.com/api/payments/paymongo/webhook`.
  Kung gagamitin, itama rin ang `PAYMENT_SUCCESS_URL` / `PAYMENT_FAILURE_URL` sa
  deployed domain. Production disables the demo GCash authorization page and
  refuses fake-success fallback when provider credentials/requests fail.
- Dormigo AI: set `GEMINI_API_KEY` kung gagamitin ang existing AI service.

Hindi pa live-tested ang external Google, SMTP, PayMongo, Gemini, Render, o Aiven
accounts; kailangan ang sarili mong accounts/configuration para doon. Walang
service o billing subscription na ginawa sa task na ito.

## 8. Puwede pa bang i-edit habang deployed?

**Oo.** Edit sa VS Code/Codespaces → test sa local/dev database → review → approve
push → commit/push sa approved branch → deploy sa Render. Hindi kailangang burahin
ang live system para magdagdag ng feature. Ang changes na nasa local files lang
ay hindi pa live.

Kapag manually controlled ang Render: pagkatapos ng approved GitHub update,
Render → Manual Deploy → Deploy latest commit. Kapag handa ka nang automatic,
set Auto-Deploy to On Commit o After CI Checks Pass. Para sa protected workflow,
gumamit ng feature branch/PR at i-merge sa `main` pagkatapos ng review.

Huwag direktang mag-edit ng application source sa Render shell: mapapalitan iyon
ng Git checkout sa susunod na deploy. Hiwalay ang code, Aiven records at disk
uploads. Ang git pull ay code lang; hindi nito dina-download ang live DB at files.
Ang Render rollback ay code rollback din; hindi automatic database rollback.

Kapag **na-push na pagkatapos ng approval**, ito ang pang-update ng existing local
VS Code checkout mo (clean working tree muna):

```powershell
git switch main
git pull --ff-only origin main
npm ci --omit=dev
npm run migrate
npm start
```

Hindi mo pa makukuha sa `git pull` ang unpushed review changes. I-apply muna ang
patch kung gusto mong i-review/test ngayon nang walang GitHub write.

## 9. Verification commands

```powershell
npm run check
npm test
```

Optional integration tests use a **separate disposable database ending in `_test`**.
Nagmi-mutate sila ng test schema at fixtures; huwag gumamit ng production DB:

```powershell
$env:NODE_ENV="test"
$env:DB_NAME="dormmap_review_test"
$env:RUN_DB_TESTS="true"
npm run test:integration
Remove-Item Env:RUN_DB_TESTS
Remove-Item Env:NODE_ENV
Remove-Item Env:DB_NAME
```

## 10. Common errors

| Error | Check |
| --- | --- |
| `EACCES ... /var/data/uploads` | Walang writable disk sa path. Free: remove `UPLOAD_DIR` or set `./public/uploads`; paid: verify disk mount `/var/data`. |
| `ECONNREFUSED` locally | Running ba ang MySQL? Tama ba ang host at port? |
| Aiven connection timeout | Service status, network allowlist, outbound ranges, port |
| `self-signed certificate` | Actual Aiven CA contents/path, `DB_SSL=true` |
| `Unknown database` | Gumawa muna ng database sa Aiven Console; exact `DB_NAME` |
| `Table ... doesn't exist` | Run `npm run migrate` using the same environment |
| Login repeats after HTTPS deployment | Production session secret, proxy config, DB Sessions table |
| Lost images after deploy | Persistent disk, `UPLOAD_DIR`, transfer of old local files |
| Render build launches Electron | Use `npm ci --omit=dev`, not `npm run build` |
| Port already in use locally | Stop the other process or change local `PORT` |

## Official references (checked 29 October 2026, Manila)

- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/web-services
- https://render.com/docs/deploys
- https://render.com/docs/disks
- https://render.com/docs/free
- https://render.com/docs/blueprint-spec
- https://aiven.io/docs/products/mysql/howto/connect-from-mysql-workbench
- https://aiven.io/docs/platform/concepts/tls-ssl-certificates
- https://aiven.io/docs/products/mysql/howto/migrate-database-mysqldump
- https://sidorares.github.io/node-mysql2/docs/documentation/ssl

## Live landing page and account approvals

- Browser tabs show the DormMap icon and `DormMap` only.
- The landing totals use approved, active owners' individual houses (or one legacy property per owner), active `OwnerTenants`, active institutions, and distinct approved barangay official jurisdictions. Tenant user accounts alone do not mean someone has moved in. “Added this month” uses property creation dates in Philippine time.
- Public updates use a Socket.io invalidation event with no private account fields, then fetch a fresh snapshot. A 15-second visible-tab refresh also catches changes made outside the running server.
- School searches use BPLO institution coordinates first, then a cached Photon/OpenStreetMap lookup; nearby means within 3 km straight-line distance. They still focus the map when no boarding houses exist. Barangay searches focus the selected place and match that barangay; price-only searches cover Bongabong. Unknown prices and map pins are never invented.
- BPLO can set precise school coordinates under **Institutions**, and barangay coordinates under **Barangay Management → Edit**. If a place cannot be resolved, the page explains it; no arbitrary school coordinate is substituted. Missing pins are listed where applicable but cannot be shown as markers or used for nearby-school searches.
- `MAP_GEOCODING_URL` is optional and defaults to `https://photon.komoot.io/api/`. This public demo allows reasonable use but has no availability guarantee. DormMap caches lookups for 24 hours, serializes requests, and only looks up a selected place. Use a dedicated Photon-compatible endpoint for larger traffic. Existing BPLO coordinates work without the external provider. Attribution remains OpenStreetMap. No Google key is needed for the current map.
- New barangay signups (password and Google) start **pending**. BPLO reviews them under **Barangay Management → Barangay account approvals**. Pending/rejected/revision/suspended officials cannot access either dashboard pages or APIs. Existing approved accounts retain their status; review/suspend them individually if needed.
- Owner signup and Google profile completion require an **approved, active, nonarchived barangay official account** for the selected barangay. The form disables unavailable barangays; the server repeats the check. A barangay master record alone does not qualify. Owners still require their own barangay review after applying.
- Additive migration adds optional latitude/longitude to `BploBarangays`; it does not delete existing records. Run `npm run migrate` before starting locally; Render's `start:render` already does this.

Mapping alternatives: keep Leaflet/OpenStreetMap for the current implementation; MapTiler supports Leaflet if a different tile style is wanted. Google Maps JavaScript API supports custom markers and Places, but requires a separate integration and Google project/API setup. Review provider billing/quotas before switching. Changing a provider should preserve the DormMap database search and approval logic.

References: https://github.com/komoot/photon · https://docs.maptiler.com/leaflet/ · https://developers.google.com/maps/documentation/javascript/overview
