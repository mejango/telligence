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

test("layout utilities on a dialog surface win over the shell's defaults", async ({ page }) => {
  await installBrowserBoundary(page);
  const response = await page.goto("/create", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(response);
  await expect(page.getByRole("heading", { name: "Create a revnet" })).toBeVisible();

  // The transaction review, shared with Juicebox Money, lays out its dialog
  // surface with utilities (ModalDialog's className), on ModalDialog's own
  // scrolling surface. Every other dialog keeps the shell's centered, unpadded
  // defaults, and its panel scrolls inside itself.
  const layout = await page.evaluate(() => {
    const read = (className: string) => {
      const dialog = document.createElement("dialog");
      dialog.className = className;
      dialog.appendChild(document.createElement("div"));
      document.body.appendChild(dialog);
      dialog.showModal();
      const style = getComputedStyle(dialog);
      const result = {
        display: style.display,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        paddingLeft: style.paddingLeft,
        paddingTop: style.paddingTop,
        overflowY: style.overflowY,
        backdrop: getComputedStyle(dialog, "::backdrop").backgroundColor,
      };
      dialog.close();
      dialog.remove();
      return result;
    };
    return {
      wide: window.matchMedia("(min-width: 40rem)").matches,
      shell: read("ui-dialog"),
      review: read(
        "ui-dialog overflow-y-auto items-start justify-center px-3 py-5 sm:px-6 sm:py-10",
      ),
    };
  });

  expect(layout.shell).toEqual({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: "0px",
    paddingTop: "0px",
    overflowY: "hidden",
    backdrop: "rgba(0, 0, 0, 0.8)",
  });
  expect(layout.review).toEqual({
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingLeft: layout.wide ? "24px" : "12px",
    paddingTop: layout.wide ? "40px" : "20px",
    overflowY: "auto",
    backdrop: "rgba(0, 0, 0, 0.8)",
  });
});

test("a standalone confirm taller than a phone screen scrolls to its Try again", async ({
  page,
}) => {
  await installBrowserBoundary(page);
  await page.setViewportSize({ width: 390, height: 844 });
  // A deterministic-build route that opens a real confirm with forty rows.
  const response = await page.goto("/confirm-proof", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(response);
  const confirm = page.getByRole("dialog", { name: "Confirm a long plan" });
  await expect(confirm).toBeVisible();

  // ModalDialog's surface scrolls, and this confirm overflows it.
  expect(
    await confirm.evaluate((dialog) => ({
      overflowY: getComputedStyle(dialog).overflowY,
      overflows: dialog.scrollHeight > dialog.clientHeight,
    })),
  ).toEqual({ overflowY: "auto", overflows: true });
  await expect(confirm.getByRole("heading", { name: "Confirm a long plan" })).toBeInViewport();
  const send = confirm.getByRole("button", { name: "Try again" });
  await expect(send).not.toBeInViewport();

  // A person's scroll, not a script's, brings the footer into reach.
  await page.mouse.move(195, 420);
  await page.mouse.wheel(0, 5000);
  await expect(send).toBeInViewport();
  await send.click();
  await expect(page.locator("[data-confirm-proof-pressed]")).toHaveAttribute(
    "data-confirm-proof-pressed",
    "send",
  );
});
