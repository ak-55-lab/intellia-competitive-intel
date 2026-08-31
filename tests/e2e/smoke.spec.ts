import { expect, test } from "@playwright/test";

test("live workspace exposes only real-time collection controls", async ({ page }) => {
  await page.goto("/research");
  await expect(page.getByRole("button", { name: "Run intelligence" })).toBeVisible();
  await expect(page.getByText("Company brain", { exact: true })).toBeVisible();
  await expect(page.getByText("Preview mode.")).toHaveCount(0);
  await expect(page.getByText("Generate preview", { exact: true })).toHaveCount(0);
});

test("only seller-facing navigation is shipped", async ({ page }) => {
  await page.goto("/research");
  await expect(page.getByRole("link", { name: "Live Intelligence" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Battlecards|Tenant Config|Credentials/i })).toHaveCount(0);
});
