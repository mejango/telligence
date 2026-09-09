import { IpfsImage } from "@/components/IpfsImage";
import { ipfsUri } from "@/lib/ipfs";
import { JBCENTER_MAX_IMAGE_BYTES, jbCenterIpfs } from "@/lib/jbcenter-ipfs";
import { useMutation } from "@tanstack/react-query";
import { twMerge } from "tailwind-merge";

export const pinFile = async (file: File) => {
  if (file.size > JBCENTER_MAX_IMAGE_BYTES) {
    throw new Error("Images must be 25 MB or smaller.");
  }
  const pin = await jbCenterIpfs.pinImage(file);
  return { Hash: pin.cid };
};

export function IpfsImageUploader({
  onUploadSuccess,
  disabled = false,
  className,
}: {
  onUploadSuccess: (cid: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      const ipfsCid = await pinFile(file);
      onUploadSuccess(ipfsCid.Hash);

      return ipfsCid;
    },
  });

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    uploadFile.mutate(file);
  };

  return (
    <div className={twMerge("mb-5", className)}>
      <input
        className={twMerge(
          "block w-full border-2 border-solid border-melon-300 bg-melon-25 bg-clip-padding px-2 py-[0.32rem] text-sm font-normal text-zinc-700 transition duration-300 ease-in-out file:-mx-2 file:-my-[0.32rem] file:overflow-hidden file:border-0 file:border-solid file:border-inherit file:bg-melon-50 file:px-2 file:py-[0.32rem] file:text-sm file:text-zinc-700 file:transition file:duration-150 file:ease-in-out file:[border-inline-end-width:2px] file:[margin-inline-end:0.5rem] hover:border-melon-400 hover:file:bg-melon-100 focus:border-melon-600 focus:text-zinc-700 focus:outline-none",
          (disabled || uploadFile.isPending) &&
            "cursor-not-allowed file:bg-zinc-100 file:text-zinc-400 hover:file:bg-zinc-100",
        )}
        id="file_input"
        type="file"
        disabled={disabled || uploadFile.isPending}
        onChange={handleFileChange}
        accept="image/jpeg,image/png"
      />
      {uploadFile.isPending && <div className="text-md text-gray-500">Uploading...</div>}
      {uploadFile.error && (
        <div className="text-md text-red-500">Logo upload failed, try again.</div>
      )}
      {uploadFile.data && (
        <div className="mt-3 overflow-hidden">
          <IpfsImage
            src={ipfsUri(uploadFile.data.Hash)}
            alt="Uploaded file"
            width={80}
            height={200}
            fallback={<div className="text-sm text-zinc-500">Preview unavailable.</div>}
          />
        </div>
      )}
    </div>
  );
}
