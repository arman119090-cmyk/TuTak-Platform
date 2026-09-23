// Placeholder product illustrations, generated as SVG.
//   /media/placeholder/{kind}.svg?c=RRGGBB&i=RRGGBB
// kind: product | packaging | installed | detail | lifestyle | hero
// A friendly, generic air-freshener figure — deliberately NOT a copy of the
// manufacturer's character artwork (brand assets need authorisation).

const HEX = /^[0-9a-fA-F]{6}$/;
const KINDS = new Set(["product", "packaging", "installed", "detail", "lifestyle", "hero"]);

function mix(hex: string, target: number, amount: number): string {
  const n = Number.parseInt(hex, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (target - c) * amount));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function figure(color: string, ink: string, x: number, y: number, s: number): string {
  // Rounded body, face, and a vent clip — scaled around (x, y).
  const dark = mix(color, 0, 0.18);
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-9" y="92" width="18" height="46" rx="6" fill="${mix(color, 0, 0.45)}"/>
    <path d="M-62 20c0-46 28-78 62-78s62 32 62 78c0 42-26 72-62 72S-62 62-62 20Z" fill="${color}"/>
    <path d="M-62 20c0-46 28-78 62-78 12 0 23 4 33 11-44 2-72 40-72 86 0 22 6 40 17 53-24-12-40-39-40-72Z" fill="${dark}" opacity=".35"/>
    <ellipse cx="-20" cy="6" rx="7.5" ry="10" fill="${ink}"/>
    <ellipse cx="20" cy="6" rx="7.5" ry="10" fill="${ink}"/>
    <circle cx="-17.5" cy="2" r="2.6" fill="#fff"/>
    <circle cx="22.5" cy="2" r="2.6" fill="#fff"/>
    <path d="M-20 34c11 12 29 12 40 0" stroke="${ink}" stroke-width="6" stroke-linecap="round" fill="none"/>
  </g>`;
}

function svg(kind: string, c: string, ink: string): string {
  const color = `#${c}`;
  const inkColor = `#${ink}`;
  const bg = mix(c, 255, 0.72);
  const bg2 = mix(c, 255, 0.86);
  let scene = "";
  switch (kind) {
    case "packaging":
      scene = `<rect x="250" y="150" width="300" height="500" rx="28" fill="#fff"/>
        <rect x="250" y="150" width="300" height="120" rx="28" fill="${color}"/>
        <rect x="250" y="240" width="300" height="30" fill="${color}"/>
        ${figure(color, inkColor, 400, 420, 1.1)}`;
      break;
    case "installed":
      scene = `<rect x="80" y="330" width="640" height="200" rx="40" fill="${mix(c, 0, 0.72)}"/>
        ${[0, 1, 2, 3, 4].map((i) => `<rect x="120" y="${360 + i * 32}" width="560" height="14" rx="7" fill="${mix(c, 0, 0.6)}"/>`).join("")}
        ${figure(color, inkColor, 400, 300, 1.05)}`;
      break;
    case "detail":
      scene = figure(color, inkColor, 400, 380, 2.3);
      break;
    case "lifestyle":
    case "hero":
      scene = `<circle cx="600" cy="170" r="90" fill="${bg2}"/>
        <path d="M0 620 Q400 520 800 620 V800 H0Z" fill="${mix(c, 255, 0.55)}"/>
        ${figure(color, inkColor, 400, 360, 1.6)}`;
      break;
    default:
      scene = `<ellipse cx="400" cy="690" rx="190" ry="26" fill="${mix(c, 0, 0.25)}" opacity=".18"/>${figure(color, inkColor, 400, 360, 1.75)}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800" role="img">
  <rect width="800" height="800" fill="${bg}"/>
  ${scene}
</svg>`;
}

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const kind = name.replace(/\.svg$/, "");
  if (!KINDS.has(kind)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const c = url.searchParams.get("c") ?? "E9E7E1";
  const i = url.searchParams.get("i") ?? "111111";
  if (!HEX.test(c) || !HEX.test(i)) return new Response("Bad colour", { status: 400 });
  return new Response(svg(kind, c, i), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      // SVG is served as an image; forbid script execution if opened directly.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    },
  });
}
