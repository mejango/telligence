"use client";

import { ProjectRichText } from "@/components/ui/html";

export const RichPreview = ({ source }: { source: string }) => {
  if (!source?.trim()) {
    return null;
  }

  try {
    return (
      <ProjectRichText
        className="break-words [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:decoration-teal-500"
        source={source.trim()}
      />
    );
  } catch (error) {
    console.error("HTML sanitization failed:", error);
    return <div className="break-words">{source}</div>;
  }
};
