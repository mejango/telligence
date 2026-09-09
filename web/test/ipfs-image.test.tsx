import { TierMediaPreview } from "@/app/[slug]/components/v6/shop/TierMediaPreview";
import { IpfsImage } from "@/components/IpfsImage";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const CID = "bafkreihz5xk2crdko5mllpxbfa443m2o6pmzcmbg5b3uvif6ho4x45z674";

describe("IPFS image failure handling", () => {
  it("uses the shared Juicebox Center gateway and falls back cleanly", () => {
    render(
      <IpfsImage
        src={`ipfs://${CID}/logo.png`}
        alt="Project logo"
        width={48}
        height={48}
        fallback={<span>Project image unavailable</span>}
      />,
    );

    const image = screen.getByRole("img", { name: "Project logo" });
    expect(image).toHaveAttribute("src", `https://juicebox.center/ipfs/${CID}/logo.png`);
    expect(image).not.toHaveAttribute("srcset");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");

    fireEvent.error(image);
    expect(screen.getByText("Project image unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Project logo" })).not.toBeInTheDocument();
  });

  it("never renders an arbitrary metadata URL", () => {
    render(
      <IpfsImage
        src="https://attacker.example/tracker.png"
        alt="Project logo"
        fallback={<span>Safe fallback</span>}
      />,
    );

    expect(screen.getByText("Safe fallback")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a bounded inert inline SVG from project metadata", () => {
    const svg =
      "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2010%2010%22%3E%3Crect%20width%3D%2210%22%20height%3D%2210%22%2F%3E%3C%2Fsvg%3E";
    render(<IpfsImage src={svg} alt="Inline project logo" fallback={<span>Safe fallback</span>} />);

    expect(screen.getByRole("img", { name: "Inline project logo" })).toHaveAttribute("src", svg);
  });

  it("rejects active inline SVG metadata", () => {
    render(
      <IpfsImage
        src="data:image/svg+xml,%3Csvg%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E%3C%2Fsvg%3E"
        alt="Unsafe project logo"
        fallback={<span>Safe fallback</span>}
      />,
    );

    expect(screen.getByText("Safe fallback")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Unsafe project logo" })).not.toBeInTheDocument();
  });

  it("keeps shop cards usable when tier media fails in the browser", () => {
    render(
      <TierMediaPreview
        media={{ image: `https://juicebox.center/ipfs/${CID}/item.png` }}
        tierId={7}
        alt="Shop item"
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Shop item" }));
    expect(screen.getByText("#7")).toBeInTheDocument();
  });
});
