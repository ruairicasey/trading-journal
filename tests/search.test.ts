import { describe, expect, test } from "vitest";
import { firstSnippet, MAX_TERMS, parseSearch, snippet } from "@/lib/search";

describe("parseSearch", () => {
  test("words, quoted phrases, lowercase, no duplicates, capped", () => {
    expect(parseSearch('Retest  "VWAP reclaim" btc retest')).toEqual(["retest", "vwap reclaim", "btc"]);
    expect(parseSearch('"" a')).toEqual(["a"]);
    expect(parseSearch(undefined)).toEqual([]);
    expect(parseSearch(Array.from({ length: 20 }, (_, i) => `w${i}`).join(" "))).toHaveLength(MAX_TERMS);
    expect(parseSearch('"unclosed phrase')).toEqual(['"unclosed', "phrase"]);
  });
});

describe("snippet", () => {
  test("marks every term in a window around the first hit, without cutting words", () => {
    const text =
      "Lots of chop early. " +
      "filler ".repeat(30) +
      "Then the VWAP reclaim worked and vwap held into the close. " +
      "more ".repeat(40);
    const segs = snippet(text, ["vwap", "reclaim"])!;
    expect(segs[0].text).toBe("…");
    expect(segs.at(-1)!.text).toBe("…");
    expect(segs.filter((x) => x.hit).map((x) => x.text)).toEqual(["VWAP", "reclaim", "vwap"]);
    const joined = segs.map((x) => x.text).join("");
    expect(joined).toContain("Then the VWAP reclaim worked");
    expect(joined).toMatch(/^…filler /); // starts on a whole word
  });

  test("a hit deep inside a long token keeps its window; non-ASCII case folding keeps offsets right", () => {
    const url = "see https://www.tradingview.com/x/" + "a".repeat(80) + "RETEST" + "b".repeat(30) + " later";
    expect(
      snippet(url, ["retest"])!
        .filter((x) => x.hit)
        .map((x) => x.text),
    ).toEqual(["RETEST"]);
    // "İ" lowercases to two characters: offsets must still point at the right text
    expect(
      snippet("İİİ then the vwap reclaim", ["vwap"])!
        .filter((x) => x.hit)
        .map((x) => x.text),
    ).toEqual(["vwap"]);
    expect(
      snippet("Über den Retest", ["über"])!
        .filter((x) => x.hit)
        .map((x) => x.text),
    ).toEqual(["Über"]);
    expect(
      snippet("a+b (c) [d]", ["(c)"])!
        .filter((x) => x.hit)
        .map((x) => x.text),
    ).toEqual(["(c)"]);
  });

  test("a phrase is marked as one hit; nothing found → null", () => {
    expect(
      snippet("short note about the vwap reclaim", ["vwap reclaim", "vwap"])!
        .filter((x) => x.hit)
        .map((x) => x.text),
    ).toEqual(["vwap reclaim"]);
    expect(snippet("nothing here", ["zebra"])).toBeNull();
    expect(snippet(null, ["a"])).toBeNull();
    expect(snippet("abc", [])).toBeNull();
  });

  test("firstSnippet takes the first field that matches", () => {
    const m = firstSnippet(
      [
        ["Notes", "no match"],
        ["Review", "the Retest held"],
        ["Tags", "#retest"],
      ],
      ["retest"],
    );
    expect(m?.label).toBe("Review");
  });
});
