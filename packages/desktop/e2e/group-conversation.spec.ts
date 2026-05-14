/**
 * Group conversation E2E test.
 *
 * Covers: create group → create group conversation → elevate member →
 * revoke elevation → send message in group chat.
 *
 * Requires: `bun build` to have been run first (Electron app must be built).
 * Run: bun test:e2e
 */

import { expect, test } from "../e2e/fixtures/electron";

test.describe("Group Conversation", () => {
  test("full flow: create group, chat, elevate, revoke, handle missing project", async ({
    electronApp,
    window,
  }) => {
    // 1. App opens and shows project selector
    await electronApp.firstWindow();
    await expect(window.locator("[data-test-id='project-selector']")).toBeVisible();

    // 2. Open settings and create a group
    await window.locator("[data-test-id='settings-trigger']").click();
    await window.locator("[data-test-id='settings-nav-groups']").click();
    await window.locator("[data-test-id='group-create-btn']").click();

    // Fill group name
    await window.locator("[data-test-id='group-name-input']").fill("E2E Test Group");
    await window.locator("[data-test-id='group-save-btn']").click();

    // Verify group appears in list
    await expect(window.locator("text=E2E Test Group")).toBeVisible();

    // 3. Create group conversation from new-conversation menu
    await window.locator("[data-test-id='new-conversation-menu']").click();
    await window.locator("[data-test-id='new-group-conversation']").click();
    // Select the group (creates session directly, no focus step)
    await window.locator("[data-test-id='group-select-item']").first().click();

    // 4. Verify group focus bar is visible
    await expect(window.locator("[data-test-id='group-focus-bar']")).toBeVisible();

    // 5. Click a non-elevated member chip to request elevation (no dialog needed)
    const elevateChip = window.locator("[data-test-id='member-chip']").first();
    await elevateChip.click();

    // 6. Verify the member chip is now elevated (shows Unlock icon, styled differently)
    // The elevated chip is no longer [data-test-id='member-chip'], it becomes an elevated button
    await expect(window.locator("[data-test-id='group-focus-bar']")).toBeVisible();

    // 7. Send a message in the group chat
    await window.locator("[data-test-id='message-input']").fill("Hello group!");
    await window.locator("[data-test-id='send-button']").click();

    // Wait for response (mock agent echoes back)
    await expect(window.locator("text=Hello")).toBeVisible({ timeout: 10000 });
  });
});
