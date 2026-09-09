import { isMobileDevice, mobileWalletLinks, walletDappUrl } from "@/lib/walletLinks";
import { describe, expect, it } from "vitest";

const CID = "bafybeif2pn5x3mxfhin4cflqyeu3spqlanc3r6nutyufh7ijw54gggtdra";

describe("mobile wallet links", () => {
  it("rewrites every deployed IPFS subdomain gateway for a wallet browser", () => {
    for (const gateway of ["inbrowser.link", "dweb.link", "w3s.link"]) {
      expect(walletDappUrl(`https://${CID}.ipfs.${gateway}/project#pay`)).toBe(
        `https://juicebox.center/ipfs/${CID}/project#pay`,
      );
    }
  });

  it("creates a MetaMask dapp handoff without losing the current route", () => {
    const page = "https://revnet.money/artizen?tab=pay#checkout";
    const metamask = mobileWalletLinks(page)[0];
    expect(metamask.name).toBe("MetaMask");
    expect(decodeURIComponent(metamask.url.split("/dapp/")[1])).toBe(
      page.replace(/^https?:\/\//, ""),
    );
  });

  it("recognizes phone and touch-iPad browsers", () => {
    expect(isMobileDevice({ userAgent: "Mozilla/5.0 (Android 16)" })).toBe(true);
    expect(
      isMobileDevice({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isMobileDevice({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });
});
