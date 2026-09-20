import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Same four record columns as icon.svg, scaled for the iOS home screen (which adds its own corner mask).
const BARS = [
  { color: "#ff7061", height: 73 },
  { color: "#4dd6e8", height: 118 },
  { color: "#3ddc97", height: 90 },
  { color: "#a684e0", height: 51 },
];

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 10, paddingBottom: 30, background: "#060a14" }}>
        {BARS.map((bar) => (
          <div key={bar.color} style={{ width: 25, height: bar.height, borderRadius: 5, background: bar.color }} />
        ))}
      </div>
    ),
    size,
  );
}
