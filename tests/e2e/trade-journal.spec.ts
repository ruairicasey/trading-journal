import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

const saved = (page: Page) => expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 10_000 });

/** A small, valid PNG (solid colour), built in-test. */
function pngBytes(w = 64, h = 36, rgb: [number, number, number] = [40, 120, 200]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function openTrade(page: Page, index: number) {
  await page.goto("/trades?tab=closed");
  const id = await page.getByTestId("trade-row").nth(index).getAttribute("data-trade-id");
  await page.goto(`/trades/${id}`);
  await page.waitForLoadState("networkidle");
  return id!;
}

test.describe("Edit trade: Analysis and Notes (demo data)", () => {
  test("analysis: pick confluences via search, set context and review, persists after reload", async ({ page }) => {
    await openTrade(page, 8);
    await page.getByRole("tab", { name: /Analysis/ }).click();

    // demo trades are pre-journaled: only switch single-selects ON (clicking an active chip clears it)
    const ensureOn = async (group: string, name: string) => {
      const r = page.getByRole("radiogroup", { name: group }).getByRole("radio", { name, exact: true });
      if ((await r.getAttribute("aria-checked")) !== "true") await r.click();
    };
    await ensureOn("Entry timeframe", "2H"); // never used by the demo seed
    await ensureOn("Market condition", "Ranging");
    const htf = page.getByRole("group", { name: "Higher-timeframe confluence" });
    await htf.getByRole("checkbox", { name: "30m" }).click(); // demo seeds only 1H/4H/1D/1W
    await htf.getByRole("checkbox", { name: "12H" }).click();

    const picker = page.getByTestId("confluence-picker");
    await picker.getByLabel("Search Confluences").fill("naked");
    await picker.getByRole("checkbox", { name: "Naked POC" }).click();
    await picker.getByLabel("Search Confluences").fill("");
    await expect(picker.getByRole("button", { name: "Remove Naked POC" })).toBeVisible();

    await ensureOn("Trade grade", "A+");
    await page.getByLabel("Custom max R").fill("2.7");
    await page.getByRole("button", { name: "More retests" }).click();
    await page.getByRole("button", { name: "More retests" }).click();
    await saved(page);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: /Analysis/ }).click();
    await expect(page.getByRole("radiogroup", { name: "Entry timeframe" }).getByRole("radio", { name: "2H", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("confluence-picker").getByRole("button", { name: "Remove Naked POC" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Trade grade" }).getByRole("radio", { name: "A+" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Custom max R")).toHaveValue("2.7");
    await expect(htf.getByRole("checkbox", { name: "30m" })).toHaveAttribute("aria-checked", "true");
    await expect(htf.getByRole("checkbox", { name: "12H" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("retests")).not.toHaveText("—");
  });

  test("notes: text, tags, review, screenshots by upload and paste; persists after reload", async ({ page }) => {
    await openTrade(page, 9);
    await page.getByRole("tab", { name: /Notes/ }).click();

    await page.getByLabel("Trade rationale").fill("Reclaim of VAL after a sweep; e2e note.");
    await page.getByLabel("Add tag").fill("e2e-tag");
    await page.getByLabel("Add tag").press("Enter");
    await expect(page.getByTestId("tags")).toContainText("#e2e-tag");
    const partial = page.getByRole("radiogroup", { name: "Rules followed" }).getByRole("radio", { name: "Partial" });
    if ((await partial.getAttribute("aria-checked")) !== "true") await partial.click();
    await saved(page);

    const shots = page.getByTestId("screenshot");
    const before = await shots.count();
    await page.getByTestId("screenshot-input").setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: pngBytes() });
    await expect(shots).toHaveCount(before + 1, { timeout: 30_000 });

    // paste an image (synthetic clipboard event, like Cmd/Ctrl+V of a copied screenshot)
    const b64 = pngBytes(48, 27, [200, 80, 60]).toString("base64");
    await page.evaluate(async (data) => {
      const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], "pasted.png", { type: "image/png" }));
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt }));
    }, b64);
    await expect(shots).toHaveCount(before + 2, { timeout: 30_000 });

    // served privately as an image
    const src = await shots.last().locator("img").getAttribute("src");
    expect(src).toMatch(/^\/api\/files\/screenshots\//);
    const res = await page.request.get(src!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^image\/(webp|jpeg)$/);
    expect(res.headers()["cache-control"]).toContain("private");

    await shots.last().getByLabel("Screenshot caption").fill("Pasted exit");
    await shots.last().getByLabel("Screenshot caption").press("Enter");
    await page.waitForTimeout(500);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: /Notes/ }).click();
    await expect(page.getByLabel("Trade rationale")).toHaveValue("Reclaim of VAL after a sweep; e2e note.");
    await expect(page.getByTestId("tags")).toContainText("#e2e-tag");
    await expect(page.getByRole("radiogroup", { name: "Rules followed" }).getByRole("radio", { name: "Partial" })).toHaveAttribute("aria-checked", "true");
    await expect(shots).toHaveCount(before + 2);
    await expect(shots.last().getByLabel("Screenshot caption")).toHaveValue("Pasted exit");

    // delete one
    page.once("dialog", (d) => d.accept());
    await shots.last().getByRole("button", { name: "Delete screenshot" }).click();
    await expect(shots).toHaveCount(before + 1);
    await page.reload();
    await page.getByRole("tab", { name: /Notes/ }).click();
    await expect(shots).toHaveCount(before + 1);
  });

  test("a non-image disguised as PNG is rejected by the server", async ({ page }) => {
    const id = await openTrade(page, 10);
    const res = await page.request.post("/api/screenshots", {
      multipart: { tradeId: id, file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>") } },
    });
    expect(res.status()).toBe(422);
  });
});
