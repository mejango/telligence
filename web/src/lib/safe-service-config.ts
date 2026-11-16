import { jbCenterAppOrigin, jbCenterBaseUrl } from "@/lib/jbcenter-config";
import { configureSafeServiceProxy } from "@bananapus/nana-sdk-core/safe-service";

// Configure before queue/creation reads; the API key stays in Center.
configureSafeServiceProxy(`${jbCenterBaseUrl()}/v1/safe`, {
  ...(typeof window === "undefined" ? { origin: jbCenterAppOrigin() } : {}),
});

export * from "@bananapus/nana-sdk-core/safe-service";
