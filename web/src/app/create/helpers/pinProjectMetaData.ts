import {
  JBCENTER_MAX_IMAGE_BYTES,
  JBCENTER_MAX_MEDIA_BYTES,
  jbCenterIpfs,
} from "@/lib/jbcenter-ipfs";
import { JBProjectMetadata } from "@bananapus/nana-sdk-core";

export async function pinProjectMetadata(metadata: JBProjectMetadata) {
  return pinJsonMetadata(metadata as unknown as Record<string, unknown>);
}

/** Pin metadata directly through Juicebox Center's trusted browser API. */
export async function pinJsonMetadata(metadata: Record<string, unknown>) {
  return (await jbCenterIpfs.pinJson(metadata)).cid;
}

/** Pin item media directly through Juicebox Center's trusted browser API. */
export async function pinMediaFile(file: File) {
  if (file.size > JBCENTER_MAX_MEDIA_BYTES) {
    throw new Error("Media must be 500 MB or smaller.");
  }
  // Images go through the buffered file endpoint; the streamed media endpoint
  // is for large video/audio.
  const pin =
    file.type.startsWith("image/") && file.size <= JBCENTER_MAX_IMAGE_BYTES
      ? await jbCenterIpfs.pinImage(file)
      : await jbCenterIpfs.pinMedia(file);
  return pin.cid;
}
