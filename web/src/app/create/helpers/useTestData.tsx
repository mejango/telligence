import { useFormContext } from "@/lib/forms";
import { useEffect } from "react";
import { SHORTER_TEST_FORM_DATA, TEST_FORM_DATA } from "../constants";
import { RevnetFormData } from "../types";

export function useTestData() {
  const { setValues } = useFormContext<RevnetFormData>();
  useEffect(() => {
    // Development convenience only — never expose form-overwriting console
    // hooks in production builds.
    if (process.env.NODE_ENV !== "development") return;

    const fillTestData = (data: RevnetFormData) => {
      setValues(data);
      console.log("Test data loaded successfully! 🚀");
      console.log("Form fields populated with:");
      console.dir(data);
    };

    Object.defineProperty(window, "testdata", {
      get: () => {
        fillTestData(TEST_FORM_DATA);
        return "filled.";
      },
      configurable: true,
    });

    Object.defineProperty(window, "testdata2", {
      get: () => {
        fillTestData(SHORTER_TEST_FORM_DATA);
        return "filled.";
      },
      configurable: true,
    });

    return () => {
      delete (window as any).testdata;
      delete (window as any).testdata2;
    };
  }, [setValues]);
}
