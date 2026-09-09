import { expect, test } from "@playwright/test";
import {
  expectSecurityHeaders,
  installBrowserBoundary,
  retryUntilVisible,
} from "./browser-support";

/**
 * Every modal in this app is a native `<dialog>` opened with `showModal()`, so
 * the browser owns the top layer and the inertness of everything outside it.
 * jsdom has neither, which makes this the only place the guarantee is provable:
 * a real browser refuses to focus or hit-test an inert node, stacks dialogs
 * newest-on-top, and restores the page when the last one closes.
 */

/** An inert node cannot take focus and cannot be the target of a pointer. */
const probeReachability = () =>
  ({
    focusable: (() => {
      const probe = document.getElementById("shape-probe-button") as HTMLElement | null;
      if (!probe) return false;
      probe.focus();
      return document.activeElement === probe;
    })(),
    hitTestable: (() => {
      const probe = document.getElementById("shape-probe-button");
      if (!probe) return false;
      const box = probe.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return probe.contains(hit);
    })(),
  }) as const;

test("an open dialog inerts the page, stacks, and restores it on close", async ({ page }) => {
  await installBrowserBoundary(page);
  await page.addInitScript(() =>
    window.localStorage.setItem("revnet:view-as:v1", "0x2222222222222222222222222222222222222222"),
  );
  const response = await page.goto("/create", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(response);
  await expect(
    page.getByRole("heading", { name: /What would you build with a budget to think/ }),
  ).toBeVisible();

  // A page-level control that must stay reachable whenever no dialog is open.
  await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.id = "shape-probe";
    probe.style.cssText = "position:fixed;top:8px;left:8px;z-index:1000";
    const button = document.createElement("button");
    button.id = "shape-probe-button";
    button.textContent = "Background control";
    probe.appendChild(button);
    document.body.appendChild(probe);
  });
  expect(await page.evaluate(probeReachability)).toEqual({ focusable: true, hitTestable: true });

  const dialog = page.getByRole("dialog");
  const accountMenu = page.getByRole("menu", { name: "Viewed account" });
  await retryUntilVisible(
    () => page.getByRole("button", { name: /^Viewing as/ }).click(),
    accountMenu,
  );
  await retryUntilVisible(
    () => page.getByRole("menuitem", { name: "View as another account…" }).click(),
    dialog,
  );

  // The shell is the element itself, in the top layer, with a painted backdrop.
  expect(
    await page.evaluate(() => {
      const open = document.querySelector("dialog[open]");
      return {
        tag: open?.tagName ?? null,
        modal: open?.matches(":modal") ?? false,
        backdrop: open ? getComputedStyle(open, "::backdrop").backgroundColor : null,
      };
    }),
  ).toEqual({ tag: "DIALOG", modal: true, backdrop: "rgba(0, 0, 0, 0.8)" });

  // Everything outside it is inert: no focus, no pointer.
  expect(await page.evaluate(probeReachability)).toEqual({ focusable: false, hitTestable: false });

  // Both controls are backed by state owned by the component that renders the
  // dialog, so every keystroke re-renders it with fresh inline callbacks —
  // the same churn the payment card produces while quoting. Neither the
  // inertness nor the caret may move.
  const accountInput = page.getByRole("textbox", { name: "Account to view the site as" });
  await accountInput.click();
  await page.keyboard.type("0x11111111");
  await expect(accountInput).toBeFocused();
  expect(await page.evaluate(probeReachability)).toEqual({ focusable: false, hitTestable: false });

  // A dialog opened on top nests natively: it is interactive, the one beneath
  // it is not.
  await page.evaluate(() => {
    const stacked = document.createElement("dialog");
    stacked.id = "stacked-probe";
    const button = document.createElement("button");
    button.id = "stacked-probe-button";
    button.textContent = "Stacked control";
    button.addEventListener("click", () => {
      button.dataset.clicked = "true";
    });
    stacked.appendChild(button);
    document.body.appendChild(stacked);
    stacked.showModal();
  });
  const stackedButton = page.locator("#stacked-probe-button");
  await stackedButton.click();
  await expect(stackedButton).toHaveAttribute("data-clicked", "true");
  expect(
    await page.evaluate(() => {
      const input = document.querySelector(
        'input[aria-label="Account to view the site as"]',
      ) as HTMLElement | null;
      input?.focus();
      return document.activeElement === input;
    }),
  ).toBe(false);

  // Escape closes only the topmost dialog, then the one beneath it.
  await page.keyboard.press("Escape");
  await expect(page.locator("#stacked-probe")).not.toHaveAttribute("open", /.*/);
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => page.evaluate(probeReachability))
    .toEqual({ focusable: false, hitTestable: false });

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The dialog element closes in the browser; React restores the page in the effect
  // cleanup that follows, a frame or two later. Poll rather than read the gap.
  await expect
    .poll(async () => page.evaluate(probeReachability))
    .toEqual({ focusable: true, hitTestable: true });
  await expect.poll(async () => page.evaluate(() => document.body.style.overflow)).toBe("");

  await page.evaluate(() => {
    document.getElementById("shape-probe")?.remove();
    document.getElementById("stacked-probe")?.remove();
  });
});
