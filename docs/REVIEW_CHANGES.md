# DormMap review notes

Prepared: 29 October 2026, Manila

**Current review branch:** `codex/live-notifications-navigation`, based on main `9c34d0c64b4e188bc3ba7adc170c7dbb18a0288d`. PRs #1–#3 are already merged. This change does not deploy Render.

## Live notifications, messaging and registration usability

- All four portals use an authenticated notification bell with exact unread counts, local destination links, individual/read-all acknowledgement, pending-work sidebar badges, and English empty/error feedback. Notification read updates are scoped to the signed-in identity.
- Authenticated SSE (`/api/portal/events`) delivers invalidation signals after commits. REST supplies authorized data; no message bodies or tenant names travel in event payloads. Connections heartbeat, reconnect and revalidate on a five-minute rotation. A 30-second resync and tab-visibility refresh recover missed events. Existing Socket.IO remains available for public maps and prior payment flows.
- Relevant visible portal sections refresh automatically; active modal forms and input editing are protected from background replacement. This improves freshness, not database/network processing speed. SSE clients are process local, suitable for the current single app instance; multi-instance deployments need shared event distribution. No new environment variables or migrations are required by this PR.
- Owner and barangay inboxes resolve real user names. Owner conversations correctly include outgoing messages and barangay replies. Message bodies are escaped in owner and tenant views; owner sends validate the recipient against existing conversations/linked tenants and whitelist writable fields.
- New notifications cover reviewer account/branch applications, messages, rent bills, maintenance responses and scoped announcements; existing application/payment/review notifications also flow through the shared bell. English notification titles avoid four-byte emoji failures in legacy database tables.
- Owner maintenance requests now have a scoped review panel and status/response action connected to the tenant's request and notification. Review and room actions retain existing permission checks. A broken owner Manage Rooms navigation call is corrected; action buttons have clearer touch/focus feedback.
- Room registration shows one room editor at a time, with previous/next, direct room selection and precise validation. All rooms remain in the submitted payload. The mobile editor scrolls within a bounded area. Step 3 terms and checkbox sizing are compact. Unknown Google-account feedback is an inline red login notice without a SweetAlert popup. Remaining Tagalog instructions in the touched portals are replaced with English.

Validation for this revision: 28 unit tests and 17 database scenarios plus their parent runner, including named messaging, notification read isolation, authenticated SSE and owner/tenant maintenance permissions. Browser checks exercise password/Google-style registration, room switching, unknown-account feedback, live message-to-bell-to-inbox navigation, replies, mobile overflow and static action-handler resolution across all four roles. External Google OAuth, real payment collection and Render deployment are not claimed.

## Owner registration and inventory enhancement

- Both password and Google completion registration create a primary property and actual room records together. Five gallery categories, five supporting documents and a profile photo are validated on the server (5 MB each). Failed submissions clean up their new uploads.
- Owners specify property type, up to 50 floors, room numbers, bedspace/solo/shared/studio/family/apartment types, physical beds, person capacity, monthly rent basis and existing unavailable slots. Room numbers must be unique on each floor. Bedspaces require one capacity slot per bed; solo rooms have capacity one.
- A single account can manage branches in other barangays that have an approved active official. Additional branches stay hidden from tenants until reviewed, with actual room inventory, by their assigned barangay or BPLO. Revision/rejection/suspension notes are visible to the owner. Branch listing approval does not issue or replace a business permit; existing permit records remain owner based.
- Tenant assignments track household size and unique bed numbers. Whole-room rentals become unavailable after one lease, including a family smaller than the room capacity. Existing unavailable slots can be converted to identified tenants without counting occupancy twice. Suspension blocks new occupancy but permits move-outs.
- Tenant/public listing details show floors, room type, physical beds, occupancy, owner-reported unavailable spaces, free spaces and monthly price basis. Tenant identities are not exposed publicly. These counts update on listing refresh; this change does not claim every open details panel streams room changes.
- Shared navigation gains keyboard focus, mobile drawer controls, panel history and responsive table scrolling. Registration has file previews and room-plan summaries, with validated transitions between steps. Privacy text no longer claims an unverified hosting provider.

Legacy room prices retain their existing per-person basis. Existing branches default to approved to preserve their prior visibility. New columns are additive through `npm run migrate`; review a database backup before production migration. No new environment variable is required.

Validation: 27 unit tests; 16 database scenarios plus their parent runner, including multipart registration, concurrent occupancy, household/bed rules, scoped branch approval, checkout and signed webhook handling. Desktop/mobile browser checks cover the registration wizard, file previews, map pin, branch review, room/tenant changes and listing details. No live Google OAuth, real-money charge or Render deployment is claimed. PayMongo settlement limitations documented below are unchanged.

## Existing system, based on the repository

The root XianFire application has four roles, rather than only admin/student:
tenant, boarding house owner, barangay, and BPLO super admin. Its routes and
controllers cover dorm maps/search, applications, rooms/tenants, rent/payment
records, messages, documents, maintenance requests, permits, barangay submissions,
reports/exports, audit logs, settings and optional external integrations. These
are existing modules; this review does not claim every original workflow was
independently verified.

## Features added

1. **Saved dorms:** authenticated tenants can save/unsave listings. Choices are
   stored in MySQL per tenant and survive a reload or server restart. Duplicate
   saves are prevented by a database unique index. Keys identify individual
   establishments, even if one owner has several houses.
2. **Compare dorms:** select two or three dorms to compare rent, barangay/address,
   available rooms/slots, amenities, house rules and owner contact details. A
   keyboard-accessible native dialog supports scrolling on small screens.
3. **Practical browse filters:** maximum monthly rent, available rooms, saved
   dorms and lowest-rent sorting. Filters update both the cards and map. The Map
   button uses the listing's stable key, so sorting/filtering cannot open the
   wrong marker.
4. **More accurate tenant browse data:** approved, active owners only; filtering
   uses each establishment's barangay; full rooms do not count as available;
   primary-house legacy rooms remain included. Unknown prices and locations are
   shown honestly instead of inventing rent or a map pin.

The new save/unsave API routes are:

```text
PUT    /tenant-dashboard/api/saved-dorms/:listingKey
DELETE /tenant-dashboard/api/saved-dorms/:listingKey
```

They use the verified signed-in tenant, never a tenant ID supplied by a client.

## Deployment changes

- Added the standard `npm start` and `npm run start:render` commands.
- Added Aiven custom port and CA/hostname-verified TLS support.
- Replaced the fixed secret and in-memory sessions with environment configuration
  and a Sequelize/MySQL session store. Production cookies use HTTPS; Render's
  reverse proxy is trusted explicitly.
- Replaced the destructive, interactive migration with an additive bootstrap.
  It creates missing tables/columns without dropping data, deleting unknown
  legacy columns, or changing existing column types. An advisory lock serializes
  bootstrap runs. Startup no longer performs automatic `alter` operations.
- Added a database-backed `/healthz` endpoint and graceful shutdown.
- Added configurable upload storage and an optional paid Render disk blueprint.
  Existing committed uploads copy to the disk without overwriting newer files.
- Added interactive admin creation without a published default password.
- Turned the existing AWS deployment workflow into a manual workflow. Added CI
  configuration for Node 24 and MySQL 8.4. Removed automatic push shortcuts.
- Rewrote the starter README and added a detailed Tagalog deployment/local guide.

## Production behavior fixes included

- Disabled demo seeding by default; the optional development seeder requires an
  admin and POST. Production cannot use the simulated GCash authorization page.
- Production payment-provider failures do not fall back to a simulated checkout.
- Fixed webhook signing-secret lookup, verification of original request bytes,
  test/live signature selection, timing-safe comparison and timestamp checks.
- Removed the failed-Google-password path that exposed a password-reset token.
  Password login rotates the session and saves it before redirecting.
- WebSocket private user/role subscriptions are derived from the authenticated
  session. Arbitrary client-to-user chat event relaying was removed.
- Stopped caching account pages and uploads through the PWA service worker.
- Prevented repeated image fallback error loops in the tenant template.

## Validation completed

| Check | Result |
| --- | --- |
| JavaScript syntax | 105 files checked |
| Automated unit/config/security checks | 10 passed |
| Database integration scenarios | All 5 scenarios passed; runner reports 6 checks including the parent test |
| Browser workflows | 8 passed, no uncaught page errors |
| Desktop/mobile browser sizes | 1440 × 1000 and 390 × 844 |
| Patch applies to the exact base commit | Verified in a separate clean local checkout |
| GitHub writes | None |

Database integration used **MariaDB 10.11 with Sequelize's MySQL dialect**, not
the user's Aiven account. It tested additive migration/idempotency, preserved
records/unknown columns, login/rendering, approved listings and inventory,
tenant isolation, and persistence of sessions/saved choices/uploads across an
actual Node server restart.

Browser checks used seeded test accounts and loaded the project's CDN scripts
through a local test cache. External map tiles and external image services were
stubbed, so those providers' availability was not tested. Save persistence,
saved/budget/vacancy filters, comparison/limit, correct map association after
filtering and mobile width were checked in Chromium.

## Limits to keep in view

- No live Render/Aiven deployment or live Google, SMTP, PayMongo or Gemini account
  test was performed. Put your own credentials in environment settings.
- The prepared disk blueprint uses paid Render compute. Free Render cannot keep
  the current local uploads; external object storage is a separate enhancement.
- Existing document URLs still use the project's `/uploads` serving behavior.
  Role-scoped private document downloads are a recommended follow-up before
  storing sensitive identity documents in a public deployment.
- The additive bootstrap is not a full versioned migration system. Future
  renames/type changes need an explicit migration and a backup.
- The GitHub Actions MySQL 8.4 workflow is prepared but has not run on GitHub,
  because nothing was pushed.
- Your own VS Code/localhost was not accessed; follow the supplied local commands.

## How to review

Apply `DormMap-review.patch` to a clean checkout at the base commit, or open the
separate `DormMap-review-source.zip` snapshot. The full guide is
`docs/DEPLOY_RENDER_AIVEN.md`. Review the diff in VS Code or a Codespaces terminal
without pushing. Changes in this workspace do not appear in the GitHub website
until a later approved push.
