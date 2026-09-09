"use client";

import { pinFile } from "@/components/IpfsFileUploader";
import { useFormContext } from "@/lib/forms";
import { ipfsUri } from "@/lib/ipfs";
import { useCallback, useState } from "react";
import { FieldGroup } from "./Fields";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

type EditorElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * A markdown textarea FieldGroup. Image files dropped or pasted into it are
 * pinned through the app's IPFS route and inserted at the cursor as markdown
 * image links in the stored `ipfs://` format.
 */
export function MarkdownFieldGroup({ groupClassName, ...props }: Parameters<typeof FieldGroup>[0]) {
  const { setFieldValue } = useFormContext();
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadFailed, setUploadFailed] = useState(false);
  const name = props.name;

  const insertImages = useCallback(
    async (element: EditorElement, files: File[]) => {
      setUploadFailed(false);
      for (const file of files) {
        setUploadCount((count) => count + 1);
        try {
          const { Hash } = await pinFile(file);
          const alt =
            file.name
              .replace(/\.[^.]+$/u, "")
              .replace(/[[\]()\\]/gu, "")
              .trim() || "image";
          const snippet = `![${alt}](${ipfsUri(Hash)})`;
          const value = element.value;
          const start = element.selectionStart ?? value.length;
          const end = element.selectionEnd ?? start;
          setFieldValue(name, `${value.slice(0, start)}${snippet}${value.slice(end)}`);
          const caret = start + snippet.length;
          requestAnimationFrame(() => element.setSelectionRange(caret, caret));
        } catch {
          setUploadFailed(true);
        } finally {
          setUploadCount((count) => count - 1);
        }
      }
    },
    [name, setFieldValue],
  );

  const onDragOver = useCallback((event: React.DragEvent<EditorElement>) => {
    if (event.dataTransfer.types.includes("Files")) event.preventDefault();
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<EditorElement>) => {
      const images = Array.from(event.dataTransfer.files).filter((file) =>
        IMAGE_TYPES.has(file.type),
      );
      if (event.dataTransfer.files.length === 0) return;
      event.preventDefault();
      void insertImages(event.currentTarget, images);
    },
    [insertImages],
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent<EditorElement>) => {
      const images = Array.from(event.clipboardData.files).filter((file) =>
        IMAGE_TYPES.has(file.type),
      );
      if (images.length === 0) return;
      event.preventDefault();
      void insertImages(event.currentTarget, images);
    },
    [insertImages],
  );

  return (
    <div className={groupClassName}>
      <FieldGroup
        {...props}
        component="textarea"
        onDragOver={onDragOver}
        onDrop={onDrop}
        onPaste={onPaste}
      />
      {uploadCount > 0 && <p className="mt-1 text-sm text-zinc-500">Uploading image...</p>}
      {uploadFailed && <p className="mt-1 text-sm text-red-500">Image upload failed, try again.</p>}
    </div>
  );
}
