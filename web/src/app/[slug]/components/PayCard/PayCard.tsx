"use client";

import { V6PayCard } from "../v6/pay/V6PayCard";
import { SelectedSuckerProvider } from "./SelectedSuckerContext";

export function PayCard() {
  return (
    <div className="flex flex-col rounded-xl w-full">
      {/* <h2 className="mb-4">Join network</h2> */}
      <SelectedSuckerProvider>
        <V6PayCard />
      </SelectedSuckerProvider>
    </div>
  );
}
