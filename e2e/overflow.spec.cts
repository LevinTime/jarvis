import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const viewports = [
  { name: "375x667", width: 375, height: 667 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "360x800", width: 360, height: 800 },
] as const;

const pages = [
  { name: "kalender", button: "Kalender" },
  { name: "heute", button: "Heute" },
  { name: "aufgaben", button: "Aufgaben" },
  { name: "chat", button: "Chat" },
  { name: "t3", button: "T3" },
] as const;

async function assertInside(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const offenders: string[] = [];
    for (const node of document.body.querySelectorAll("*")) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) {
        continue;
      }
      const visible = Math.min(rect.right, width) - Math.max(rect.left, 0);
      const onScreen = visible > 1 && rect.bottom > 0 && rect.top < height;
      if (!onScreen) {
        continue;
      }
      if (rect.right > width + 1) {
        const el = node as HTMLElement;
        const label = typeof el.className === "string" ? el.className : el.tagName;
        offenders.push(`${el.tagName}.${label} left=${Math.round(rect.left)} right=${Math.round(rect.right)}`);
      }
    }
    return {
      scroll: document.documentElement.scrollWidth,
      width,
      offenders: offenders.slice(0, 10),
    };
  });
  expect(result.offenders, result.offenders.join("\n")).toEqual([]);
  expect(result.scroll).toBeLessThanOrEqual(result.width);
}

for (const viewport of viewports) {
  test(`five pages stay on screen at ${viewport.name}`, async ({ page }) => {
    await mkdir(path.resolve("docs/screenshots"), { recursive: true });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Seiten" });
    await expect(nav.getByRole("button")).toHaveCount(5);
    await expect(page.getByRole("heading", { name: /Levin/ })).toBeVisible();

    for (const item of pages) {
      await nav.getByRole("button", { name: item.button, exact: true }).click();
      const slide = page.getByRole("region", { name: item.button });
      await expect.poll(async () => {
        const next = await slide.boundingBox();
        const x = next?.x ?? 999;
        return x > -2 && x < 2;
      }).toBe(true);
      const box = await slide.boundingBox();
      expect(Math.abs((box?.width ?? 0) - viewport.width)).toBeLessThan(3);
      if (item.name === "t3") {
        await expect(page.getByText("T3 Code ist nicht erreichbar")).toBeVisible();
        await expect(page.getByRole("link", { name: "T3 Code öffnen" })).toBeVisible();
      }
      await assertInside(page);
      await page.screenshot({
        path: path.resolve("docs/screenshots", `${viewport.name}-${item.name}.png`),
      });
      await expect(nav.getByRole("button", { name: item.button, exact: true })).toHaveAttribute("aria-current", "page");
    }

    await nav.getByRole("button", { name: "Heute", exact: true }).click();
    const today = page.getByRole("region", { name: "Heute" });
    await expect.poll(async () => {
      const x = (await today.boundingBox())?.x ?? 999;
      return x > -2 && x < 2;
    }).toBe(true);
    await page.getByRole("button", { name: "Einstellungen" }).click();
    const dialog = page.getByRole("dialog", { name: "Einstellungen" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("T3-Adresse")).toHaveValue("http://127.0.0.1:9");
    await assertInside(page);
    await page.screenshot({
      path: path.resolve("docs/screenshots", `${viewport.name}-einstellungen.png`),
    });
  });
}
