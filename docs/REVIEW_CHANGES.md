# DormMap review notes

Prepared: 29 October 2026, Manila

**Current review branch:** `codex/admin-owner-gcash`, based on main commit `4b3e8d6a6b09f28bfde76e108ce5d234a1e234a2`.

The live landing/approval changes from PR #1 have already been merged. This branch contains the subsequent admin, owner, tenant/room, unregistered-map and payment fixes.

The original shortlist/Render/Aiven changes described below and the upload fallback fix were already pushed to main. This new branch adds live public statistics, geographic search with no invented pins/prices, and BPLO approval of barangay accounts. Owner registration now requires an approved active barangay official. See the final section of `docs/DEPLOY_RENDER_AIVEN.md` for definitions and setup. No live Render deployment is performed by this change.

This branch also fixes Google admin provisioning through an explicit verified-email operator allowlist, property/profile synchronization, room/tenant occupancy transactions, owner offers and tenant confirmation, rent bills and PayMongo reconciliation, and scoped red unregistered map notices. It adds real inventory-based BPLO/barangay counts and owner pagination. See `docs/DEPLOY_RENDER_AIVEN.md` for the required `ADMIN_GOOGLE_EMAILS` configuration and merchant settlement limitations.

Validation: 23 unit tests; 13 database scenarios plus the parent runner, including concurrent occupancy/checkout requests and a signed HTTP webhook; desktop/mobile browser checks and owner property registration, room/tenant/move-out, red-pin publication/details, BPLO review and live landing updates. No live Google session, real-money charge, or Render deployment is claimed. The configured PayMongo merchant receives hosted checkout funds; owner GCash metadata is not automatic per-owner settlement.

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
