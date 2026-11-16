"use client";

import { createContext } from "react";

/** Project-owned dialogs leave the native top layer while identity is unverified. */
export const ProjectRouteBlockedContext = createContext(false);
