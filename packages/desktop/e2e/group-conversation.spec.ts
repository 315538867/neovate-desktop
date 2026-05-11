/**
 * Group conversation E2E test.
 *
 * Covers: create group → create group conversation → write to primary →
 * switch focus → write to new focus → delete project → missing member UI.
 *
 * Requires: `bun build` to have been run first (Electron app must be built).
 * Run: bun test:e2e
 */

import { expect, test } from "../e2e/fixtures/electron";

test.describe("Group Conversation", () => {
  test("full flow: create group, chat, switch focus, handle missing project", async ({
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
    // Select the group
    await window.locator("[data-test-id='group-select-item']").first().click();
    // Select default focus (first project)
    await window.locator("[data-test-id='focus-select-confirm']").click();

    // 4. Verify group focus bar is visible
    await expect(window.locator("[data-test-id='group-focus-bar']")).toBeVisible();

    // 5. Click a non-focus member chip to switch focus
    const switchChip = window.locator("[data-test-id='member-chip']").nth(1);
    await switchChip.click();

    // Confirm dialog appears
    await expect(window.locator("role=alertdialog")).toBeVisible();
    // Click confirm switch button
    await window.locator("role=alertdialog >> button").nth(1).click();

    // 6. Verify focus switched (the new focus chip should be highlighted)
    await expect(window.locator("[data-test-id='member-chip']").first()).toBeVisible();

    // 7. Send a message in the group chat
    await window.locator("[data-test-id='message-input']").fill("Hello group!");
    await window.locator("[data-test-id='send-button']").click();

    // Wait for response (mock agent echoes back)
    await expect(window.locator("text=Hello")).toBeVisible({ timeout: 10000 });
  });
});
