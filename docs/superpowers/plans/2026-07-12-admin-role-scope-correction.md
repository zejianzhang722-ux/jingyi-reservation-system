# Admin Role and Scope Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate administrator role capabilities from optional building data scope, while routing ordinary and counselor approvals to the correct roles.

**Architecture:** Introduce an explicit admin scope mode (`global` or `building`) instead of treating a missing building as an error or an implicit privilege. Keep role capability checks independent: `admin` handles ordinary operations, `counselor` adds advanced approval capabilities, and `super_admin` owns all management capabilities.

**Tech Stack:** Node.js, Express, MySQL, Vue 3, Pinia, Vue Router, Element Plus, existing assertion scripts.

---

## File map

- Modify `server/sql/schema.sql` and add a migration under `server/sql/migrations/`: persist explicit `scope_type` for administrator accounts.
- Modify `server/src/config/mock-db.js` and `server/sql/seed.sql`: provide global guide, global counselor, global super administrator, plus a building-scoped guide fixture.
- Modify `server/src/middleware/adminScope.js`: derive global/building scope from `scope_type`, not role or missing building.
- Modify `server/src/controllers/adminController.js` and `authController.js`: validate and return scope fields.
- Modify `admin/src/views/Account/Index.vue`: allow super administrators to select “全院” or a building only for guide administrators.
- Modify `admin/src/router/adminRoutes.js` and `admin/src/utils/adminRolePolicy.js`: correct capability menus.
- Modify audit, poster, dashboard, and pending-count logic where role queues are currently mixed.
- Modify `scripts/security-runtime-check.js`, `scripts/security-hardening-check.js`, `scripts/admin-site-role-policy-check.mjs`, and focused checks.

### Task 1: Persist explicit administrator scope

**Files:**
- Modify: `server/sql/schema.sql`
- Create: `server/sql/migrations/20260712_admin_scope_type.sql`
- Modify: `server/src/config/mock-db.js`
- Modify: `server/sql/seed.sql`
- Test: `scripts/security-hardening-check.js`

- [ ] **Step 1: Write failing schema and fixture checks**

Assert that `admins.scope_type` exists with values `global` and `building`; global guide/counselor/super fixtures have `scope_type='global'` and `building_id=NULL`; a building guide fixture has `scope_type='building'` and a valid building ID. Assert migration converts existing counselor/super accounts to global and leaves existing guide accounts requiring an explicit decision rather than guessing a building.

- [ ] **Step 2: Run the check and verify failure**

Run: `node scripts/security-hardening-check.js`

Expected: failure because `scope_type` and migration are absent.

- [ ] **Step 3: Add schema, migration, and corrected fixtures**

Use the invariant:

```text
scope_type = global   => building_id IS NULL
scope_type = building => building_id is a positive existing building ID
```

Seed `admin` as global, `counselor` as global, `superadmin` as global, and add a separate building-scoped guide test account. Remove the incorrect B/C role binding introduced by commit `073a232`.

- [ ] **Step 4: Run the schema check**

Run: `node scripts/security-hardening-check.js`

Expected: `security-hardening-check passed`.

- [ ] **Step 5: Commit**

Commit message: `fix(auth): separate role from data scope`.

### Task 2: Enforce scope independently from role

**Files:**
- Modify: `server/src/middleware/adminScope.js`
- Modify: `server/src/middleware/auth.js`
- Modify: `server/src/services/socketAuthService.js`
- Modify: `server/src/controllers/authController.js`
- Test: `scripts/security-runtime-check.js`
- Test: `scripts/socket-auth-check.js`

- [ ] **Step 1: Write failing scope behavior tests**

Test these real cases: global guide can read all buildings but cannot use advanced management; building guide sees only its building; counselor and super administrator are global; invalid combinations are rejected; changing scope invalidates a live socket session.

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/security-runtime-check.js && node scripts/socket-auth-check.js`

Expected: global guide fails because current middleware requires a building for every non-super account.

- [ ] **Step 3: Implement explicit scope resolution**

`loadAdminScope` must return:

```js
{
  adminId: Number(admin.id),
  role: normalizedRole,
  isGlobal: admin.scope_type === 'global',
  buildingId: admin.scope_type === 'building' ? Number(admin.building_id) : null
}
```

Reject `building` without a valid building ID and reject `global` with a non-null building ID. Include `scopeType` in login responses and socket principals.

- [ ] **Step 4: Verify scope tests**

Run: `node scripts/security-runtime-check.js && node scripts/socket-auth-check.js`

Expected: both pass.

- [ ] **Step 5: Commit**

Commit message: `fix(auth): enforce explicit admin data scope`.

### Task 3: Correct role capabilities and approval queues

**Files:**
- Modify: `admin/src/router/adminRoutes.js`
- Modify: `admin/src/utils/adminRolePolicy.js`
- Modify: relevant routes/controllers under `server/src/routes/`, `server/src/controllers/`, and `server/src/middleware/roleAuth.js`
- Test: `scripts/admin-site-role-policy-check.mjs`
- Test: `scripts/security-runtime-check.js`

- [ ] **Step 1: Write failing capability and queue tests**

Assert: guide administrators can access dashboard, ordinary approval, check-in, all reservations, reading-room records, violations, and statistics; they cannot configure rooms/buildings/seats/rules/credit, manage accounts, backups, logs, or announcements. Counselors inherit guide operational access and add counselor approval and poster approval, but not super-only management. Super administrators can access all routes. Ordinary approval rejects `counselor_pending`; counselor approval accepts only `counselor_pending`; super administrators can use both.

- [ ] **Step 2: Run checks and verify failure**

Run: `npm run check:admin-site:roles && npm run check:security`

Expected: current route groups expose management pages to `admin` and expose mixed review queues.

- [ ] **Step 3: Implement capability groups and queue guards**

Define separate role groups for operational access, counselor approval, and super-only management. Keep building filtering after role authorization. Pending-count and dashboard items must count only the queue actionable by the current role; super administrators receive the combined count.

- [ ] **Step 4: Verify role and queue checks**

Run: `npm run check:admin-site:roles && npm run check:security`

Expected: both pass.

- [ ] **Step 5: Commit**

Commit message: `fix(admin): align capabilities with approval levels`.

### Task 4: Add scope selection to account management

**Files:**
- Modify: `server/src/controllers/adminController.js`
- Modify: `admin/src/views/Account/Index.vue`
- Modify: `admin/src/api/admin.js`
- Test: `scripts/admin-site-ux-check.mjs`
- Test: `scripts/security-runtime-check.js`

- [ ] **Step 1: Write failing account-scope tests**

Assert that only `super_admin` can create/update administrators; `admin` accepts `scopeType=global` with no building or `scopeType=building` with a valid building; `counselor` and `super_admin` are forced to global; invalid combinations return 400. Account lists return `scopeType`, `buildingId`, and a readable scope label.

- [ ] **Step 2: Run checks and verify failure**

Run: `npm run check:admin-site:ux && npm run check:security`

Expected: account form lacks scope mode and backend accepts ambiguous combinations.

- [ ] **Step 3: Implement validation and form behavior**

In the account form, show scope selection only for guide administrators. When “全院” is chosen, clear building ID; when “指定楼栋” is chosen, require a building. Show counselor and super administrator as fixed “全院”. Preserve action locks and error states already present.

- [ ] **Step 4: Verify account checks and build**

Run: `npm run check:admin-site:ux && npm run check:security && npm --prefix admin run build`

Expected: all pass.

- [ ] **Step 5: Commit**

Commit message: `feat(admin): configure guide data scope`.

### Task 5: Migrate, verify, and browser-test all roles

**Files:**
- Modify if needed: `docs/final-acceptance-checklist.md`

- [ ] **Step 1: Run the full focused suite**

Run: `npm run check:admin-site:roles && npm run check:admin-site:ux && npm run check:security && npm run check:security-hardening && npm run check:admin-miniapp && npm run check:acceptance && npm --prefix admin run build`.

Expected: every command exits 0.

- [ ] **Step 2: Verify four account variants through APIs**

Check global guide, building guide, counselor, and super administrator. Confirm expected dashboard, pending count, ordinary queue, counselor queue, account management, room configuration, and cross-building results.

- [ ] **Step 3: Verify four account variants in the browser**

Login as each role/scope, check menus, workbench emphasis, actionable queue, and absence of 403/500 requests or console errors.

- [ ] **Step 4: Confirm migration safety**

Inspect migration output or dry-run evidence. Existing guide accounts without explicit scope must be reported for administrator choice and must not be silently assigned to a random building.

- [ ] **Step 5: Commit acceptance evidence if documentation changes**

Commit message: `docs: record role and scope verification`.
