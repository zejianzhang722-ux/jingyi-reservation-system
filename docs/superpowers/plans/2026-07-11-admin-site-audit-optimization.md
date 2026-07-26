# Admin Site Audit and Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop admin site role-focused, safer to operate, clearer when data fails, and consistent across dashboard, approvals, statistics, and management pages.

**Architecture:** Preserve the existing Vue 3, Pinia, Vue Router, Element Plus, Axios, and ECharts structure. Put reusable role policy and async-state behavior in small utilities/components, then adapt existing pages without changing the data model or unrelated backend services.

**Tech Stack:** Vue 3, Vue Router 4, Pinia, Element Plus, Axios, ECharts, Vite, Node.js assertion scripts.

---

## File map

- Create `admin/src/utils/adminRolePolicy.js`: role labels, navigation priorities, dashboard copy, and role-aware shortcuts.
- Create `admin/src/utils/asyncState.js`: distinguish loading, success, empty, and failure without erasing prior data.
- Create `admin/src/components/admin/AsyncState.vue`: shared error and retry display.
- Create `scripts/admin-site-role-policy-check.mjs`: deterministic role/menu policy checks.
- Create `scripts/admin-site-ux-check.mjs`: source-level regression checks for failure states and duplicate-submit guards.
- Modify `admin/src/router/adminRoutes.js`: consume role policy and order role-specific navigation.
- Modify `admin/src/components/Layout.vue`: real pending badge, role-aware pending destination, calmer presentation.
- Modify `admin/src/components/admin/PageShell.vue`, `FilterBar.vue`, and `admin/src/styles/global.css`: consistent desktop layout and reduced motion.
- Modify `admin/src/views/Dashboard/Index.vue`: role-focused summary, actionable pending items, partial-failure state.
- Modify `admin/src/views/Reservation/ReviewQueue.vue`, `PendingList.vue`, and `CounselorPending.vue`: safer approval and return flow.
- Modify `admin/src/views/Stats/Overview.vue` and `Stats/Export.vue`: useful defaults, summaries, explicit failures, export feedback.
- Modify selected management pages only where the audit finds silent failure or unsafe repeated submission.
- Modify root `package.json`: expose focused audit checks.

### Task 1: Establish role policy with executable checks

**Files:**
- Create: `scripts/admin-site-role-policy-check.mjs`
- Create: `admin/src/utils/adminRolePolicy.js`
- Modify: `admin/src/router/adminRoutes.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing role-policy check**

Write a Node assertion script that imports the role policy and asserts: all three roles have a label; `super_admin` receives system security entries; `counselor` does not receive room configuration, export, credit configuration, logs, or backup; `admin` receives high-frequency approval and room-management entries before low-frequency content entries; every shortcut points to a route allowed for that role.

- [ ] **Step 2: Run the check and verify failure**

Run: `node scripts/admin-site-role-policy-check.mjs`

Expected: non-zero exit because `adminRolePolicy.js` does not exist.

- [ ] **Step 3: Implement the policy and navigation ordering**

Export `ROLE_LABELS`, `ROLE_NAV_PRIORITY`, `ROLE_DASHBOARD_COPY`, `ROLE_SHORTCUTS`, `getRoleLabel(role)`, and `sortRoutesForRole(routes, role)`. Keep `hasRouteRole` as the route-level source of access truth and call `sortRoutesForRole` only after filtering allowed routes.

- [ ] **Step 4: Add and run the focused command**

Add `check:admin-site:roles` to root scripts and run `npm run check:admin-site:roles`.

Expected: `admin-site-role-policy-check passed`.

- [ ] **Step 5: Commit the role-policy unit**

Commit only the files listed in this task with message `feat(admin): focus navigation by role`.

### Task 2: Add truthful shared asynchronous states

**Files:**
- Create: `admin/src/utils/asyncState.js`
- Create: `admin/src/components/admin/AsyncState.vue`
- Create: `scripts/admin-site-ux-check.mjs`
- Modify: `admin/src/components/admin/PageShell.vue`
- Modify: `admin/src/components/admin/FilterBar.vue`
- Modify: `admin/src/styles/global.css`
- Modify: `package.json`

- [ ] **Step 1: Write failing async-state assertions**

Assert that state starts as `idle`, becomes `loading`, becomes `success` or `empty` based on returned rows, and becomes `error` with a readable message while retaining the last successful value. Assert the shared component exposes a retry event and the global stylesheet includes reduced-motion handling.

- [ ] **Step 2: Run the check and verify failure**

Run: `node scripts/admin-site-ux-check.mjs`

Expected: non-zero exit because the shared state files are absent.

- [ ] **Step 3: Implement shared state and presentation**

Implement `createAsyncState(initialValue)`, `beginLoad(state)`, `finishLoad(state, value, isEmpty)`, and `failLoad(state, error)`. Build `AsyncState.vue` with `loading`, `error`, `empty`, `error-message`, and `retry` support. Remove hover movement and decorative floating animation from page headers; keep focus visibility and reduced-motion behavior.

- [ ] **Step 4: Verify focused checks and production build**

Run: `npm run check:admin-site:ux` and `npm --prefix admin run build`.

Expected: both exit successfully; build produces `admin/dist`.

- [ ] **Step 5: Commit shared experience changes**

Commit with message `feat(admin): add truthful page states`.

### Task 3: Make layout reminders role-aware and real

**Files:**
- Modify: `admin/src/components/Layout.vue`
- Modify: `admin/src/api/stats.js`
- Modify: `scripts/admin-site-ux-check.mjs`

- [ ] **Step 1: Extend failing layout assertions**

Assert the layout has no unconditional CSS notification dot, renders an accessible numeric badge only when count is positive, fetches the dashboard pending count, and maps counselor reminders to `/reservation/counselor` while other reviewers use `/reservation/pending`.

- [ ] **Step 2: Run and confirm the old layout fails**

Run: `npm run check:admin-site:ux`.

Expected: failure describing the unconditional notification marker or missing pending count.

- [ ] **Step 3: Implement real reminders**

Load pending count after authentication and on route changes that can affect approvals. Show the count with an accessible label, handle load failure without a false red marker, and navigate to the correct review queue for the current role.

- [ ] **Step 4: Verify checks and build**

Run: `npm run check:admin-site:ux && npm --prefix admin run build`.

Expected: both succeed.

- [ ] **Step 5: Commit layout changes**

Commit with message `feat(admin): show actionable pending reminders`.

### Task 4: Build a role-focused dashboard

**Files:**
- Modify: `admin/src/views/Dashboard/Index.vue`
- Modify: `admin/src/utils/adminRolePolicy.js`
- Modify: `scripts/admin-site-role-policy-check.mjs`
- Modify: `scripts/admin-site-ux-check.mjs`

- [ ] **Step 1: Add failing dashboard checks**

Assert each role has a distinct heading and shortcut set, pending rows provide a valid destination, dashboard failure does not assign an empty array over previously loaded items, and a retry control exists.

- [ ] **Step 2: Run both checks and verify failure**

Run: `npm run check:admin-site:roles && npm run check:admin-site:ux`.

Expected: dashboard-focused assertions fail.

- [ ] **Step 3: Implement role dashboard behavior**

Use current role to select title, description, metric captions, and shortcuts. Make pending rows clickable. Use `Promise.allSettled` where independent data can load separately; preserve successful data, show an inline retry for failed regions, and distinguish zero from failure.

- [ ] **Step 4: Verify build and checks**

Run: `npm run check:admin-site:roles && npm run check:admin-site:ux && npm --prefix admin run build`.

Expected: all succeed.

- [ ] **Step 5: Commit dashboard changes**

Commit with message `feat(admin): tailor dashboard to each role`.

### Task 5: Harden approval workflows

**Files:**
- Modify: `admin/src/views/Reservation/ReviewQueue.vue`
- Modify: `admin/src/views/Reservation/PendingList.vue`
- Modify: `admin/src/views/Reservation/CounselorPending.vue`
- Modify: `scripts/admin-site-ux-check.mjs`

- [ ] **Step 1: Add failing approval assertions**

Assert every approval page has a submitting guard, approval buttons bind to loading or disabled state, batch rejection collects and validates a non-generic reason, selection clears after successful reload, and a failed list request retains current rows and displays retry.

- [ ] **Step 2: Run and confirm failure**

Run: `npm run check:admin-site:ux`.

Expected: one or more approval safety assertions fail.

- [ ] **Step 3: Implement guarded, explanatory actions**

Add one in-flight guard per action, disable related buttons during submission, collect batch rejection reason using the same validated reason rules as single rejection, show conflict/server messages supplied by the interceptor, and only mutate list/selection after confirmed success.

- [ ] **Step 4: Verify checks and build**

Run: `npm run check:admin-site:ux && npm --prefix admin run build`.

Expected: both succeed.

- [ ] **Step 5: Commit approval changes**

Commit with message `fix(admin): make approval actions safe and clear`.

### Task 6: Clarify statistics and exports

**Files:**
- Modify: `admin/src/views/Stats/Overview.vue`
- Modify: `admin/src/views/Stats/Export.vue`
- Modify: `admin/src/utils/statsFormatters.js`
- Modify: `scripts/admin-site-ux-check.mjs`

- [ ] **Step 1: Add failing statistics assertions**

Assert the default range is the latest seven days, partial endpoint failures are visible per chart, successful charts remain visible, summary metrics are derived from formatted data, and export controls prevent duplicate submission and state the active range.

- [ ] **Step 2: Run and confirm failure**

Run: `npm run check:admin-site:ux`.

Expected: statistics assertions fail against the current page.

- [ ] **Step 3: Implement conclusions and explicit chart states**

Initialize the date range to seven days ending today. Add summary cards for reservation volume, average usage, busiest period, and no-show rate using formatter functions. Track each chart request separately so failure, empty, and success are not conflated. Add export loading and completion feedback.

- [ ] **Step 4: Verify formatter checks, UX checks, and build**

Run: `npm run check:admin-site:ux && npm --prefix admin run build`.

Expected: all succeed.

- [ ] **Step 5: Commit statistics changes**

Commit with message `feat(admin): make statistics actionable`.

### Task 7: Audit remaining management pages and fix only evidenced issues

**Files:**
- Inspect: `admin/src/views/Room/*.vue`, `admin/src/views/Account/Index.vue`, `admin/src/views/Credit/*.vue`, `admin/src/views/System/*.vue`
- Modify: only files with a confirmed silent failure, missing submission guard, misleading destructive action, or inaccessible critical control
- Modify: `scripts/admin-site-ux-check.mjs`

- [ ] **Step 1: Record an evidence table in the check script comments**

For each inspected page record pass/fail for retained data on load failure, guarded writes, explicit destructive confirmation, and reachable primary actions. Do not broaden scope for purely stylistic preferences.

- [ ] **Step 2: Add one failing assertion per confirmed defect**

Run: `npm run check:admin-site:ux`.

Expected: failure names the exact affected page and behavior.

- [ ] **Step 3: Apply minimal page fixes**

Use the shared async state, add submission guards, or improve confirmation text only where the audit found a defect. Preserve current APIs and forms.

- [ ] **Step 4: Verify focused and existing regression checks**

Run: `npm run check:admin-site:ux && npm run check:admin-miniapp && npm --prefix admin run build`.

Expected: all succeed.

- [ ] **Step 5: Commit audited fixes**

Commit with message `fix(admin): resolve audited management issues`.

### Task 8: Full verification and browser review

**Files:**
- Modify if needed: `docs/final-acceptance-checklist.md`
- Do not modify: `server/data/mock-feedbacks.json`

- [ ] **Step 1: Run the focused admin suite**

Run: `npm run check:admin-site:roles && npm run check:admin-site:ux && npm --prefix admin run build`.

Expected: all exit with code 0.

- [ ] **Step 2: Run repository checks proportional to touched behavior**

Run: `npm run check:security && npm run check:admin-miniapp && npm run check:acceptance`.

Expected: all checks pass; if an external service is unavailable, record the exact skipped dependency and run every remaining local check.

- [ ] **Step 3: Start the existing backend and admin development flows**

Use the documented local configuration and existing services. Do not reset or seed real data. Use test accounts only.

- [ ] **Step 4: Review four desktop pages in the browser**

Check the role dashboard, appropriate approval queue, statistics overview, and one management list at a standard desktop width and a narrower desktop width. Confirm readable hierarchy, reachable actions, visible focus, correct role menu, truthful empty/error states, and no critical horizontal overflow.

- [ ] **Step 5: Exercise three role journeys when accounts are available**

Verify super administrator, counselor, and student-admin menus and allowed actions. If accounts are unavailable, use the deterministic role-policy check and explicitly mark live role verification as not performed.

- [ ] **Step 6: Update acceptance documentation only with verified results**

Record checks executed, browser pages reviewed, account roles exercised, and any environment-limited item. Do not claim an unexecuted check passed.

- [ ] **Step 7: Confirm user-owned changes remain untouched**

Run: `git status --short`.

Expected: `server/data/mock-feedbacks.json` remains modified exactly as before and is not included in any task commit.

- [ ] **Step 8: Commit acceptance evidence if documentation changed**

Commit only the acceptance document with message `docs: record admin site verification`.
