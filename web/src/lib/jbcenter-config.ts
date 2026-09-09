import { JBCENTER_DEFAULT_URL } from "@bananapus/nana-sdk-core/jbcenter";

const DEV_SITE_URL = "https://dev.revnet.money";
const LOCAL_SITE_URL = "http://localhost:3002";
const DEV_CENTER_URL = "https://dev.juicebox.center";

function isDevSite(
  siteUrl: string | undefined,
): siteUrl is typeof DEV_SITE_URL | typeof LOCAL_SITE_URL {
  return siteUrl === DEV_SITE_URL || siteUrl === LOCAL_SITE_URL;
}

export function jbCenterBaseUrl(siteUrl = process.env.NEXT_PUBLIC_SITE_URL): string {
  return isDevSite(siteUrl) ? DEV_CENTER_URL : JBCENTER_DEFAULT_URL;
}

export function jbCenterAppOrigin(siteUrl = process.env.NEXT_PUBLIC_SITE_URL): string {
  if (!siteUrl) throw new Error("The application origin is not configured.");
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    throw new Error("The application origin is invalid.");
  }
  if (
    (siteUrl !== url.origin && siteUrl !== `${url.origin}/`) ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("The application origin is invalid.");
  return url.origin;
}
