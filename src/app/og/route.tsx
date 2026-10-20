import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site-config";

export const runtime = "nodejs";
// `size` and `contentType` are metadata-file exports (opengraph-image.tsx).
// A route handler may only export the HTTP methods and route config, and
// Next's route typing fails the build on anything else. They stay as plain
// constants: the image is still 1200x630 PNG via ImageResponse below.
const contentType = "image/png";
const size = {
  width: siteConfig.ogImage.width,
  height: siteConfig.ogImage.height,
};

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#100f0d",
          color: "#fdfbf6",
          padding: "56px 64px",
          fontFamily: '"IBM Plex Sans", sans-serif',
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(60% 45% at 14% 16%, rgba(59, 91, 219, 0.28), transparent 70%), radial-gradient(58% 42% at 86% 84%, rgba(212, 101, 47, 0.28), transparent 70%)",
          }}
        />

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ height: 10, width: 10, borderRadius: 99, background: "#d4652f" }} />
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "0.14em" }}>RELAY</span>
        </div>

        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 18 }}>
          <span
            style={{
              fontSize: 14,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#9a9488",
            }}
          >
            STUDIO CREATES DEMAND. RELAY CAPTURES IT.
          </span>
          <span
            style={{
              fontSize: 96,
              lineHeight: 0.88,
              letterSpacing: "-0.05em",
              fontWeight: 300,
              maxWidth: 950,
            }}
          >
            CREATE DEMAND
            <br />
            x
            <br />
            CAPTURE DEMAND.
          </span>
        </div>

        <div
          style={{
            position: "absolute",
            left: 64,
            right: 64,
            top: "50%",
            display: "flex",
            alignItems: "center",
            gap: 14,
            transform: "translateY(-50%)",
          }}
        >
          <span style={{ height: 1, background: "#3b5bdb", flex: 1 }} />
          <span
            style={{
              width: 42,
              height: 42,
              border: "1px solid rgba(253, 251, 246, 0.45)",
              transform: "rotate(45deg)",
              background:
                "linear-gradient(45deg, transparent 45%, rgba(59, 91, 219, 0.55) 45%, rgba(59, 91, 219, 0.55) 55%, transparent 55%), linear-gradient(-45deg, transparent 45%, rgba(212, 101, 47, 0.55) 45%, rgba(212, 101, 47, 0.55) 55%, transparent 55%)",
            }}
          />
          <span style={{ height: 1, background: "#d4652f", flex: 1 }} />
        </div>

        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span
            style={{
              fontSize: 16,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#f1ede4",
            }}
          >
            ONE GROWTH LOOP.
          </span>
          <span
            style={{
              fontSize: 14,
              color: "#9a9488",
              letterSpacing: "0.08em",
            }}
          >
            Made in Pakistan, for the world.
          </span>
        </div>
      </div>
    ),
    { ...size, headers: { "Content-Type": contentType } },
  );
}
