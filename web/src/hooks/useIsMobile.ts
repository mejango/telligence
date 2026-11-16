import * as React from "react";

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      const update = () => setIsMobile(window.innerWidth < 768);
      update();
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isMobile;
}
