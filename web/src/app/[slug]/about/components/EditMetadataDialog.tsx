"use client";

import { runSequentialWrites } from "@/app/[slug]/components/v6/operator/operatorLib";
import { FieldGroup } from "@/app/create/form/Fields";
import { MarkdownFieldGroup } from "@/app/create/form/MarkdownFieldGroup";
import { pinProjectMetadata } from "@/app/create/helpers/pinProjectMetaData";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { IpfsImageUploader } from "@/components/IpfsFileUploader";
import { RelayrPaymentSelect } from "@/components/RelayrPaymentSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import {
  requireRelayrRecoveryScopeAvailable,
  useGetRelayrTxQuote,
  useSendRelayrTx,
  waitForRelayrBundle,
} from "@/hooks/useReviewedRelayr";
import {
  isSafeConnector,
  submittedViaSafe,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import type { Project } from "@/lib/bendystraw/types";
import { FormProvider, type FormHelpers } from "@/lib/forms";
import { isRecord, issue, schema, ValidationIssue, withSchema } from "@/lib/formValidation";
import { gasWithHeadroom } from "@/lib/gas";
import { ipfsUri } from "@/lib/ipfs";
import {
  useJBChainId,
  useJBContractContext,
  useJBProjectMetadataContext,
} from "@/lib/nana/project";
import type { ChainPayment, RelayrPostBundleResponse } from "@/lib/nana/types";
import {
  readMetadataDestination,
  verifyMetadataSource,
  type MetadataDestination,
} from "@/lib/project-metadata-write";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import { formatHexEther, formatWalletError } from "@/lib/utils";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { JB_CHAINS, JBChainId, jbControllerAbi, JBCoreContracts } from "@bananapus/nana-sdk-core";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, type PublicClient } from "viem";
import { useAccount } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import {
  applyMetadataEdits,
  customPropertyCollisions,
  formatCustomProperties,
  parseCustomProperties,
} from "./metadataMerge";

type MetadataFormData = {
  customProperties: string;
  description: string;
  discord: string;
  farcaster: string;
  infoUri: string;
  logoUri: string;
  name: string;
  payDisclosure: string;
  telegram: string;
  twitter: string;
};

function metadataString(source: unknown, field: keyof MetadataFormData): string {
  if (!isRecord(source)) return "";
  const value = source[field];
  return typeof value === "string" ? value : "";
}

const metadataSchema = schema<MetadataFormData>((input) => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    issue(issues, [], "Invalid metadata");
    return issues;
  }

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    issue(issues, ["name"], "Name is required");
  } else if (input.name.trim().length > 50) {
    issue(issues, ["name"], "Name is too long");
  }
  if (typeof input.description !== "string" || input.description.trim().length === 0) {
    issue(issues, ["description"], "Description is required");
  }

  for (const field of [
    "logoUri",
    "twitter",
    "telegram",
    "discord",
    "infoUri",
    "farcaster",
    "payDisclosure",
  ]) {
    if (input[field] !== undefined && typeof input[field] !== "string") {
      issue(issues, [field], "Invalid value");
    }
  }

  if (input.customProperties !== undefined) {
    if (typeof input.customProperties !== "string") {
      issue(issues, ["customProperties"], "Invalid value");
    } else {
      const parsed = parseCustomProperties(input.customProperties);
      if (!parsed.ok) issue(issues, ["customProperties"], parsed.error);
    }
  }

  return issues;
});

interface Props {
  projects: Array<Pick<Project, "projectId" | "token" | "chainId">>;
  triggerVariant?: "default" | "outline" | "secondary";
}

export function EditMetadataDialog({ projects, triggerVariant = "outline" }: Props) {
  const [open, setOpen] = useState(false);
  const { metadata } = useJBProjectMetadataContext();
  const { contractAddress } = useJBContractContext();
  const displayedChainId = useJBChainId();
  const { toast } = useToast();
  const router = useRouter();
  const { address, chainId: connectedChainId, connector } = useAccount();
  const relayed =
    projects.length > 1 &&
    !isSafeConnector(connector) &&
    areRelayrChainsCompatible(projects.map((project) => project.chainId));

  const { getRelayrTxQuote, reset: resetRelayr } = useGetRelayrTxQuote();
  const { sendRelayrTx } = useSendRelayrTx();
  const [relayrQuote, setRelayrQuote] = useState<RelayrPostBundleResponse | null>(null);
  const [selectedPayment, selectPayment] = useState<ChainPayment | null>(null);

  const [reviewed, setReviewed] = useState<{
    destinations: Array<MetadataDestination & { metadataUri: string }>;
    name: string;
  } | null>(null);
  const { writeContractAsync, isPending } = useWriteContract({
    reverify: async (call, signer) => {
      const destination = reviewed?.destinations.find(
        (item) =>
          item.source.chainId === call.chainId &&
          item.source.controller.toLowerCase() === call.address.toLowerCase(),
      );
      if (!destination)
        throw new Error("The reviewed metadata destination is unavailable. Reopen the editor.");
      const client = getPublicClient(wagmiConfig, {
        chainId: destination.source.chainId as JBChainId,
      });
      if (!client) throw new Error("The metadata network is unavailable.");
      await verifyMetadataSource(client as PublicClient, destination.source, signer);
      requireRelayrRecoveryScopeAvailable(
        signer,
        `project-metadata:${destination.source.chainId}:${destination.source.projectId}`,
      );
    },
  });
  // The confirm's line while the metadata pins and, on several chains, the relay quote loads.
  const [preparing, setPreparing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);
  const [directChainIndex, setDirectChainIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The metadata JSON this edit is merged on top of. The context value can be a
  // server-provided subset (name/logo/description only), so it is re-fetched
  // when the dialog opens and again right before pinning. Until that authoritative
  // copy is in hand the advanced editor stays in a loading state and saving is
  // blocked, otherwise an empty custom-properties box would delete custom fields.
  const [currentMetadata, setCurrentMetadata] = useState<Record<string, unknown> | null>(null);
  const [metadataLoadFailed, setMetadataLoadFailed] = useState(false);
  const metadataReady = currentMetadata !== null;

  // Prefer the authoritative copy for the form fields too, falling back to the
  // context value while it loads.
  const initialMetadata = currentMetadata ?? metadata?.data;

  const primary = projects.find((project) => project.chainId === displayedChainId) ?? projects[0];
  const primaryChainId = primary?.chainId;
  const primaryProjectId = primary?.projectId;
  const resolveCurrentMetadata = useCallback(async (): Promise<Record<string, unknown>> => {
    if (primaryChainId === undefined || primaryProjectId === undefined)
      throw new Error("No project was selected.");
    const chainId = primaryChainId as JBChainId;
    const client = getPublicClient(wagmiConfig, { chainId });
    if (!client) throw new Error("The metadata network is unavailable.");
    return (
      await readMetadataDestination(client as PublicClient, {
        chainId,
        projectId: String(primaryProjectId),
        directory: contractAddress(JBCoreContracts.JBDirectory, chainId),
        projects: contractAddress(JBCoreContracts.JBProjects, chainId),
        permissions: contractAddress(JBCoreContracts.JBPermissions, chainId),
      })
    ).metadata;
  }, [primaryChainId, primaryProjectId, contractAddress]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setCurrentMetadata(null);
    setMetadataLoadFailed(false);

    resolveCurrentMetadata().then(
      (data) => {
        if (!cancelled) setCurrentMetadata(data);
      },
      () => {
        if (!cancelled) setMetadataLoadFailed(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open, resolveCurrentMetadata]);

  const resetQuote = useCallback(() => {
    setRelayrQuote(null);
    selectPayment(null);
    resetRelayr();
  }, [resetRelayr, selectPayment, setRelayrQuote]);

  const closeReview = useCallback(() => {
    setReviewed(null);
    setPreparing(null);
    setError(null);
    setSubmissionStatus(null);
    setDirectChainIndex(0);
    resetQuote();
  }, [resetQuote]);

  const onSuccess = useCallback(() => {
    setOpen(false);
    closeReview();

    toast({
      title: "Metadata updated!",
      description: "New data will be visible shortly.",
    });
    setTimeout(() => {
      void metadata.refetch?.();
      router.refresh();
    }, 5000);
  }, [toast, metadata, router, closeReview]);

  const review = async (
    values: MetadataFormData,
    { setSubmitting }: FormHelpers<MetadataFormData>,
  ) => {
    try {
      if (!address) throw new Error("Please connect your wallet");
      // Fail closed: never merge onto a metadata JSON we could not read.
      if (!metadataReady) throw new Error("Still loading the current metadata. Try again.");

      const customProperties = parseCustomProperties(values.customProperties ?? "");
      if (!customProperties.ok) throw new Error(customProperties.error);

      setSubmitting(true);
      setError(null);
      setPreparing("Pinning the metadata…");

      // Every destination may have a different controller, URI and document.
      // Resolve all permissions first, then apply only the fields edited in this form.
      const snapshots = await Promise.all(
        projects.map(async (project) => {
          const chainId = project.chainId as JBChainId;
          const client = getPublicClient(wagmiConfig, { chainId });
          if (!client) throw new Error(`The metadata network is unavailable on chain ${chainId}.`);
          return readMetadataDestination(
            client as PublicClient,
            {
              chainId,
              projectId: String(project.projectId),
              directory: contractAddress(JBCoreContracts.JBDirectory, chainId),
              projects: contractAddress(JBCoreContracts.JBProjects, chainId),
              permissions: contractAddress(JBCoreContracts.JBPermissions, chainId),
            },
            address,
          );
        }),
      );
      const pinned = new Map<string, Promise<string>>();
      const destinations = await Promise.all(
        snapshots.map(async (snapshot) => {
          const merged = applyMetadataEdits(
            snapshot.metadata,
            currentMetadata,
            values,
            customProperties.value,
          );
          const key = JSON.stringify(merged, (_key, value: unknown) =>
            isRecord(value)
              ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
              : value,
          );
          let cid = pinned.get(key);
          if (!cid) {
            cid = pinProjectMetadata(merged);
            pinned.set(key, cid);
          }
          return { ...snapshot, metadataUri: ipfsUri(await cid) };
        }),
      );
      setReviewed({ destinations, name: values.name.trim() });
      // Relayr requests one authorization per destination before the fee review.
      if (relayed) {
        setPreparing(
          `Getting a relay quote… Your wallet will ask for ${projects.length} signatures, one per chain.`,
        );
        if (!(await handleSubmit(destinations))) closeReview();
      }
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description: formatWalletError(e) || "Failed to update metadata",
      });
      console.error(e);
    } finally {
      setPreparing(null);
      setSubmitting(false);
    }
  };

  const handleSubmit = async (destinations = reviewed?.destinations): Promise<boolean> => {
    if (!address || !destinations?.length) return false;
    setBusy(true);
    setError(null);
    try {
      await Promise.all(
        destinations.map(async (destination) => {
          const client = getPublicClient(wagmiConfig, {
            chainId: destination.source.chainId as JBChainId,
          });
          if (!client) throw new Error("The metadata network is unavailable.");
          await verifyMetadataSource(client as PublicClient, destination.source, address);
        }),
      );
      if (!relayed) {
        destinations.forEach(({ source }) =>
          requireRelayrRecoveryScopeAvailable(
            address,
            `project-metadata:${source.chainId}:${source.projectId}`,
          ),
        );
        await runSequentialWrites({
          writes: destinations.map(({ source, metadataUri }) => ({
            abi: jbControllerAbi,
            functionName: "setUriOf",
            chainId: source.chainId as JBChainId,
            address: source.controller,
            args: [BigInt(source.projectId), metadataUri],
          })),
          account: address,
          writeContractAsync: async (call) => {
            setDirectChainIndex(projects.findIndex((project) => project.chainId === call.chainId));
            return writeContractAsync(call);
          },
          onProgress: setSubmissionStatus,
        });
        onSuccess();
        return true;
      }

      // Multi-chain - use relayr
      const relayrTransactions = [];

      for (const { source, metadataUri } of destinations) {
        const chainId = source.chainId as JBChainId;

        const controller = source.controller;
        const args = [BigInt(source.projectId), metadataUri] as const;
        const publicClient = getPublicClient(wagmiConfig, { chainId });
        if (!publicClient) {
          throw new Error(`Public client unavailable for chain ${chainId}.`);
        }

        const gasEstimate = await publicClient.estimateContractGas({
          address: controller,
          abi: jbControllerAbi,
          functionName: "setUriOf",
          args,
          account: address,
        });

        relayrTransactions.push({
          recoveryScope: `project-metadata:${chainId}:${source.projectId}`,
          metadataSource: source,
          data: {
            from: address,
            to: controller,
            value: 0n,
            gas: gasWithHeadroom(gasEstimate),
            data: encodeFunctionData({ abi: jbControllerAbi, functionName: "setUriOf", args }),
          },
          chainId,
          version: 6 as const,
          review: {
            abi: jbControllerAbi,
            functionName: "setUriOf",
            args,
            label: "Update project metadata",
            contractName: "JBController",
          },
        });
      }

      const quote = await getRelayrTxQuote(relayrTransactions);
      if (!quote) throw new Error("Failed to get relayr tx quote");

      setRelayrQuote(quote);
      // Signing may switch the wallet; prefer the chain captured before this submission.
      selectPayment(
        quote.payment_info.find((payment: ChainPayment) => payment.chain === connectedChainId) ??
          null,
      );
      return true;
    } catch (e: unknown) {
      const message = formatWalletError(e) || "Failed to update metadata";
      setError(message);
      toast({ variant: "destructive", title: "Error", description: message });
      console.error(e);
      return false;
    } finally {
      setBusy(false);
      setSubmissionStatus(null);
    }
  };

  const handlePayAndSubmit = async () => {
    if (!relayrQuote || !selectedPayment || !sendRelayrTx) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await sendRelayrTx(selectedPayment);
      if (submittedViaSafe(hash)) {
        toast({
          title: "Safe payment proposal submitted",
          description:
            "The Relayr bundle is not paid yet. Approve and execute this proposal in Safe; do not submit another payment.",
        });
        return;
      }
      await waitForRelayrBundle(relayrQuote.bundle_uuid);

      toast({
        title: "Metadata updated on every chain",
        description: "Relayr confirmed every destination transaction.",
      });
      onSuccess();
    } catch (e: unknown) {
      const message = formatWalletError(e) || "Failed to submit transaction";
      setError(message);
      toast({ variant: "destructive", title: "Error", description: message });
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const chainNames = projects
    .map((project) => JB_CHAINS[project.chainId as JBChainId]?.name ?? String(project.chainId))
    .join(", ");
  const relayFee = selectedPayment ? `${formatHexEther(selectedPayment.amount)} ETH` : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        closeReview();
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          Edit metadata
        </Button>
      </DialogTrigger>
      <DialogContent>
        <FormProvider
          initialValues={{
            name: metadataString(initialMetadata, "name"),
            description: metadataString(initialMetadata, "description"),
            logoUri: metadataString(initialMetadata, "logoUri"),
            twitter: metadataString(initialMetadata, "twitter"),
            telegram: metadataString(initialMetadata, "telegram"),
            discord: metadataString(initialMetadata, "discord"),
            infoUri: metadataString(initialMetadata, "infoUri"),
            farcaster: metadataString(initialMetadata, "farcaster"),
            payDisclosure: metadataString(initialMetadata, "payDisclosure"),
            customProperties: formatCustomProperties(currentMetadata),
          }}
          validate={withSchema(metadataSchema)}
          onSubmit={review}
          enableReinitialize
        >
          {({ handleSubmit, setFieldValue, isSubmitting, values }) => {
            const isLoading = isSubmitting || isPending || busy;
            const parsedCustom = parseCustomProperties(values.customProperties ?? "");
            const collisions = parsedCustom.ok ? customPropertyCollisions(parsedCustom.value) : [];
            return (
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>Edit metadata</DialogTitle>
                  <DialogDescription>
                    Apply your edits across the listed chains. Unchanged fields and custom
                    properties on each chain are preserved.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <FieldGroup id="name" name="name" label="Name" />

                  <div>
                    <label
                      className="block mb-1 text-md font-semibold text-gray-900 dark:text-white"
                      htmlFor="logo_input"
                    >
                      Logo
                    </label>
                    <p className="text-sm text-zinc-500 mb-2">
                      Leave empty to keep the current one.
                    </p>
                    <IpfsImageUploader
                      onUploadSuccess={(cid) => {
                        setFieldValue("logoUri", ipfsUri(cid));
                      }}
                      disabled={isLoading}
                    />
                  </div>

                  <MarkdownFieldGroup
                    id="description"
                    name="description"
                    label="Description"
                    rows={4}
                    description="Markdown supported. Drop or paste images to embed them."
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldGroup
                      id="twitter"
                      name="twitter"
                      label="Twitter"
                      placeholder="handle..."
                      autoComplete="off"
                    />
                    <FieldGroup
                      id="telegram"
                      name="telegram"
                      label="Telegram"
                      placeholder="t.me/yourchannel..."
                      autoComplete="off"
                    />
                    <FieldGroup
                      id="discord"
                      name="discord"
                      label="Discord"
                      placeholder="discord.gg/your-invite..."
                      autoComplete="off"
                    />
                    <FieldGroup
                      id="infoUri"
                      name="infoUri"
                      label="Website"
                      placeholder="example.com..."
                      autoComplete="off"
                      inputMode="url"
                    />
                    {/* Restored: `metadataMerge` treats farcaster as editor-managed, so with
                        the field commented out an existing value could not be changed or
                        removed from ANY path in the UI. */}
                    <FieldGroup
                      id="farcaster"
                      name="farcaster"
                      label="Farcaster"
                      placeholder="username..."
                      autoComplete="off"
                    />
                  </div>

                  <FieldGroup
                    id="payDisclosure"
                    name="payDisclosure"
                    label="Payment notice"
                    component="textarea"
                    rows={2}
                    placeholder="Shown to supporters before they pay. Leave empty for none."
                  />

                  <details className="border-2 border-melon-300 bg-melon-25 px-3 py-2">
                    <summary className="cursor-pointer select-none text-md font-semibold leading-6">
                      Advanced
                    </summary>
                    <div className="mt-3 space-y-2">
                      {metadataReady ? (
                        <>
                          <FieldGroup
                            id="customProperties"
                            name="customProperties"
                            label="Custom properties"
                            description="Any other fields stored with this project, as JSON. This is the full set: remove a key to delete it, leave it empty for none."
                            component="textarea"
                            rows={6}
                            spellCheck={false}
                            placeholder="{}"
                            className="font-mono text-sm"
                          />
                          {collisions.length > 0 && (
                            <p className="text-sm text-zinc-500">
                              Set by the fields above, so ignored on save: {collisions.join(", ")}
                            </p>
                          )}
                        </>
                      ) : metadataLoadFailed ? (
                        <p className="text-sm text-red-500">
                          Could not load the current metadata. Close and reopen this dialog to
                          retry. Saving is blocked so custom fields are not overwritten.
                        </p>
                      ) : (
                        <p className="text-sm text-zinc-500">Loading current metadata...</p>
                      )}
                    </div>
                  </details>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                    disabled={isLoading}
                  >
                    Cancel
                  </Button>
                  <ButtonWithWallet
                    type="submit"
                    targetChainId={
                      (relayed ? connectedChainId : projects[0].chainId) as JBChainId | undefined
                    }
                    loading={isLoading}
                    disabled={isLoading || !metadataReady}
                    connectWalletText="Connect Wallet"
                    className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                  >
                    Save changes
                  </ButtonWithWallet>
                </DialogFooter>
              </form>
            );
          }}
        </FormProvider>
        {reviewed || preparing ? (
          <TxConfirmDialog
            open
            onOpenChange={(next) => {
              if (!next) closeReview();
            }}
            title="Confirm metadata"
            chainId={
              (selectedPayment?.chain ??
                projects[directChainIndex]?.chainId ??
                projects[0].chainId) as JBChainId
            }
            preparing={!reviewed || (relayed && !relayrQuote)}
            steps={
              relayed
                ? [
                    ...projects.map((project) => ({
                      title: `Sign the authorization on ${JB_CHAINS[project.chainId as JBChainId]?.name ?? project.chainId}`,
                    })),
                    { title: relayFee ? `Pay ${relayFee} to relay` : "Pay to relay" },
                  ]
                : projects.map((project) => ({
                    title: `Save changes on ${JB_CHAINS[project.chainId as JBChainId]?.name ?? project.chainId}`,
                  }))
            }
            activeIndex={
              !busy && !isPending ? -1 : relayed && relayrQuote ? projects.length : directChainIndex
            }
            action={relayed ? "Pay and submit" : "Save changes"}
            onConfirm={() => void (relayrQuote ? handlePayAndSubmit() : handleSubmit())}
            busy={Boolean(preparing) || busy || isPending}
            disabled={relayed && !selectedPayment}
            status={preparing ?? submissionStatus}
            error={error}
          >
            <SummaryRow label="Name">{reviewed?.name}</SummaryRow>
            <SummaryRow label="On">{chainNames}</SummaryRow>
            {reviewed?.destinations.map(({ source, metadataUri }) => (
              <SummaryRow
                key={`${source.chainId}:${source.projectId}`}
                label={`${JB_CHAINS[source.chainId as JBChainId]?.name ?? source.chainId} · project ${source.projectId}`}
              >
                <span className="break-all font-mono text-xs">{metadataUri}</span>
              </SummaryRow>
            ))}
            {relayrQuote ? (
              <RelayrPaymentSelect
                payments={relayrQuote.payment_info}
                tokenSymbol="ETH"
                selectedPayment={selectedPayment}
                onSelectPayment={selectPayment}
                disabled={busy}
              />
            ) : null}
          </TxConfirmDialog>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
