import { IpfsImageUploader } from "@/components/IpfsFileUploader";
import { ipfsUri } from "@/lib/ipfs";
import { FieldGroup } from "./Fields";
import { MarkdownFieldGroup } from "./MarkdownFieldGroup";
import { useCreateForm } from "./useCreateForm";

export function ProjectDetails({ disabled = false }: { disabled?: boolean }) {
  const { setFieldValue } = useCreateForm();

  return (
    <>
      <div className="md:col-span-1">
        <h2 className="mb-4 text-lg font-bold md:mb-2">1. Look</h2>
      </div>
      <div className="md:col-span-2">
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-12">
          <FieldGroup
            id="name"
            name="name"
            label="Name"
            groupClassName="min-w-0 md:col-span-6"
            disabled={disabled}
          />
          <FieldGroup
            id="tokenSymbol"
            name="tokenSymbol"
            label="Ticker"
            groupClassName="min-w-0 md:col-span-6"
            maxLength={10}
            prefix="$"
            disabled={disabled}
          />
          <div className="min-w-0 md:col-span-12">
            <label
              className="block mb-1 text-md font-semibold text-gray-900 dark:text-white"
              htmlFor="file_input"
            >
              Logo
            </label>
            <IpfsImageUploader
              className="mb-0"
              onUploadSuccess={(cid) => {
                setFieldValue("logoUri", ipfsUri(cid));
              }}
              disabled={disabled}
            />
          </div>
        </div>
        <MarkdownFieldGroup
          id="description"
          name="description"
          label="About"
          groupClassName="mt-6"
          rows={3}
          placeholder="What is the gist?"
          description="Markdown supported. Drop or paste images to embed them."
          disabled={disabled}
        />

        <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-2">
          <FieldGroup
            id="twitter"
            name="twitter"
            label="Twitter"
            placeholder="username..."
            autoComplete="off"
            disabled={disabled}
          />
          <FieldGroup
            id="telegram"
            name="telegram"
            label="Telegram"
            placeholder="t.me/yourchannel..."
            autoComplete="off"
            disabled={disabled}
          />
          <FieldGroup
            id="discord"
            name="discord"
            label="Discord"
            placeholder="discord.gg/your-invite..."
            autoComplete="off"
            disabled={disabled}
          />
          <FieldGroup
            id="infoUri"
            name="infoUri"
            label="Website"
            placeholder="example.com..."
            autoComplete="off"
            inputMode="url"
            disabled={disabled}
          />
        </div>
      </div>
    </>
  );
}
