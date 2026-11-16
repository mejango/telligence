import { Button } from "@/components/ui/button";
import type { Metadata } from "next";
import { NotFoundMessage, NotFoundNav } from "./NotFoundMessage";

export const metadata: Metadata = { title: "Not found | Revnet" };

export default function NotFound() {
  return (
    <>
      <NotFoundNav />
      <div className="flex w-full flex-col items-center px-4 py-24 text-center">
        <h1 className="mb-3 text-4xl">Not found</h1>
        <NotFoundMessage />
        {/* A plain link: next/link here put the home bundle on every route that renders a 404. */}
        <Button asChild>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- keeps next/link off the 404 bundle */}
          <a href="/">Return Home</a>
        </Button>
      </div>
    </>
  );
}
