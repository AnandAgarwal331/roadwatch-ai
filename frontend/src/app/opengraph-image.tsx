import { ImageResponse } from "next/og";

export const alt = "RoadWatch AI - make every road safer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The link preview shown when the site is shared on WhatsApp, Telegram, X, etc.
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0b1220 0%, #123a7a 100%)",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 20,
              background: "#1558bf",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
              <path d="M4 21 9.2 4h5.6L20 21" stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="18.4" r="1.9" fill="white" />
            </svg>
          </div>
          <div style={{ marginLeft: 28, fontSize: 52, fontWeight: 700 }}>RoadWatch AI</div>
        </div>

        <div style={{ marginTop: 56, fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>Make every road safer.</div>
        <div style={{ marginTop: 28, fontSize: 34, color: "#b8c7e6" }}>
          Report road damage. AI identifies it. Cities fix what matters most.
        </div>
      </div>
    ),
    size,
  );
}
