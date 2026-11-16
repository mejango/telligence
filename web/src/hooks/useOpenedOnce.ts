import { useState } from "react";

/**
 * True from the first render where `open` is true. A lazily loaded dialog mounts then and stays
 * mounted, so its chunk loads only when first needed and it still animates closed.
 */
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}
