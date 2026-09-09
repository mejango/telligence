import { BrainMark } from "@/components/telligence/BrainMark";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    <div
      style={{
        background: "#F6FEF9",
        color: "#15281D",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "55px 70px",
        fontFamily: "monospace",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          fontSize: 29,
          letterSpacing: "-2px",
          borderBottom: "1px solid #A5E0BD",
          paddingBottom: 23,
        }}
      >
        <BrainMark width={42} height={42} style={{ color: "#3D7955", marginRight: 12 }} />
        telligence.
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 88,
          fontWeight: 700,
          letterSpacing: "-6px",
          lineHeight: 1.05,
          marginTop: 40,
        }}
      >
        <span>Throw money</span>
        <span>at a problem</span>
        <span>together</span>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          paddingTop: 20,
          borderTop: "1px solid #A5E0BD",
          fontSize: 23,
        }}
      >
        Fund recurring compute for work you believe in.
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: { "cache-control": "public, max-age=86400, s-maxage=86400" },
    },
  );
}
