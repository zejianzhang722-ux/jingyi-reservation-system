# Auth Session Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the mock-login impersonation, unsafe refresh, and stale-account authorization paths without changing reservation behavior.

**Architecture:** Add explicit environment gating and centralized account-state resolution around the existing authentication controller and middleware. Keep the current JWT and Redis model, but fail closed whenever a refresh session cannot be proven valid.

**Tech Stack:** Node.js, Express, jsonwebtoken, Redis, MySQL/mock database, existing integration test runner.

---

### Task 1: Security regression tests

**Files:**
- Modify: `server/tests/integration-check.js`

- [ ] Add requests proving production rejects `mock_code_`, refresh requires a stored refresh token, and disabled or downgraded accounts lose access.
- [ ] Run `node tests/integration-check.js` and verify the new assertions fail for the vulnerable behavior.

### Task 2: Mock login isolation

**Files:**
- Modify: `server/src/controllers/authController.js`
- Modify: `server/src/config/index.js`

- [ ] Add an explicit `ALLOW_MOCK_WECHAT_LOGIN` test-only setting.
- [ ] Reject mock codes unless the setting is enabled.
- [ ] Run the targeted integration checks and verify they pass.

### Task 3: Refresh-token validation

**Files:**
- Modify: `server/src/controllers/authController.js`

- [ ] Require a refresh token with `tokenType: refresh`.
- [ ] Require an exact match with the Redis session and fail closed on Redis errors.
- [ ] Reload the current account state and role before issuing tokens.
- [ ] Remove unreachable legacy refresh code.
- [ ] Run the targeted integration checks and verify they pass.

### Task 4: Current account authorization

**Files:**
- Modify: `server/src/middleware/auth.js`

- [ ] Load current account state for authenticated requests.
- [ ] Reject disabled or banned accounts and replace stale token roles with the current database role.
- [ ] Run the targeted and complete integration checks.

### Task 5: Publish

**Files:**
- Include only the design, plan, tests, and authentication changes from this task.

- [ ] Inspect the final diff and run the complete server test command.
- [ ] Commit on an `agent/` branch, push it to `origin`, and create a draft GitHub pull request describing root cause and validation.

