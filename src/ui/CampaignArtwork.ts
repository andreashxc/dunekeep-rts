import type { MapTheme } from "../game/types";

// Original miniature landscapes. Buildings are the game's own rendered models;
// terrain and details are resolution-independent vectors, with no extra WebGL scene.
export function campaignLandmark(theme: MapTheme): string {
  const building = (kind: string, x: number, y: number, width: number) =>
    `<image href="${import.meta.env.BASE_URL}assets/ui/buildings/${kind}.png" x="${x}" y="${y}" width="${width}" height="${width * .75}"/>`;
  const palm = (x: number, y: number, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})"><ellipse cy="3" rx="13" ry="4" fill="#46634b20"/><path d="M0 0Q-5-19 1-39" fill="none" stroke="#99714a" stroke-width="4"/><path d="m1-39-22 4 10-10 12 3-5-13 12 11 16 3 8 10-24-8 9 18-13-9-8 5Z" fill="#397f68"/><path d="m1-39 18 5M1-39-14 1" stroke="#80a778" stroke-width="2"/></g>`;
  const terrace = (color = "#e9d9ae") => `<ellipse cx="120" cy="156" rx="98" ry="17" fill="#6e705b15"/><path d="m20 120 95-42 105 39v17l-99 39-101-37Z" fill="#b7a379"/><path d="m20 120 101 39v14L20 136Z" fill="#ccb98b"/><path d="m20 120 95-42 105 39-99 42Z" fill="${color}"/><path d="m24 126 96 37 94-37" fill="none" stroke="#f3e6c7" stroke-width="2"/>`;
  const rock = (x: number, y: number, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="m-23 6 5-49 13-13 25 8 12 54-27 13Z" fill="#ac694d"/><path d="m-18-43 13-13 25 8-17 9Z" fill="#e2ad7e"/><path d="M3-39 20-48 32 6 5 19Z" fill="#be7d59"/><path d="m-21-18 24 9 23-10m-48 9 26 9 23-10" fill="none" stroke="#d69b6a" stroke-width="3"/></g>`;
  const pool = `<ellipse cx="87" cy="127" rx="46" ry="19" fill="#79a981"/><ellipse cx="87" cy="127" rx="38" ry="14" fill="#439d9e"/><path d="M59 128q25 15 56-1M69 124q14 6 25 1" fill="none" stroke="#b2d9c4" stroke-width="2"/>`;
  const river = `<path d="m113 84-20 12 20 17-34 24 31 18 27-13-27-9 34-23-19-16 13-8Z" fill="#54a6a7"/><path d="m119 87-14 9 20 16-32 25 22 13" fill="none" stroke="#a2d5c6" stroke-width="3"/>`;
  const bridge = `<path d="m87 116 42-17 15 8-42 19Z" fill="#f6e9c9"/><path d="m102 126 42-19v11l-6 3v-5q-5-8-11 4v5l-9 4v-5q-5-7-10 4v5l-6 3Z" fill="#ac9270"/><path d="m87 116 15 10v10l-15-9Z" fill="#d3bd95"/><path d="m87 111 15 8 42-17m-55 11 14 8 40-17" fill="none" stroke="#f9f0d8" stroke-width="3"/>`;
  const flag = (x: number, y: number, color: string) => `<path d="M${x} ${y + 24}v-28" stroke="#796247" stroke-width="2"/><path d="m${x + 1} ${y - 4} 18 4-3 6 3 5-18-4Z" fill="${color}"/>`;
  let scene: string;
  switch (theme) {
    case "oasis": scene = terrace() + pool + palm(45, 111, .95) + building("keep", 88, 31, 123) + palm(166, 142, .78) + building("well", 28, 112, 51); break;
    case "red-canyon": scene = terrace("#dfb58b") + rock(51, 115, 1.1) + rock(183, 111, 1.3) + `<path d="m78 133 33-19 38 25-27 15Z" fill="#f4d5a0"/>` + building("gate", 59, 69, 129) + flag(128, 64, "#2c8279"); break;
    case "salt-flat": scene = terrace("#ecebd7") + `<path d="m27 123 55-22 16 8-55 24Zm110 22 57-23 15 7-55 24Z" fill="#fff9e8"/><path d="m35 125 39-16m68 35 40-16" stroke="#d2d4bd" stroke-width="2"/>` + building("market", 58, 37, 142) + building("granary", 13, 89, 84) + `<g fill="#b3956a" stroke="#806445" stroke-width="1"><path d="m155 134 14-7 17 7-14 8Z"/><path d="m155 134 17 8v11l-17-8Zm17 8 14-8v11l-14 8Z"/></g>` + palm(183, 121, .72); break;
    case "river-valley": scene = terrace("#c4cc98") + river + building("tower", 23, 48, 92) + building("tower", 128, 38, 97) + bridge + palm(173, 147, .68); break;
    case "ancient-ruins": scene = terrace("#bfc69a") + `<path d="m42 122 63-26 66 23-65 26Z" fill="#648e70"/><path d="m54 125 59-24m-40 34 59-24" stroke="#d9dab4" stroke-width="5"/>` + building("keep", 67, 24, 126) + pool + palm(40, 105, 1) + palm(191, 137, .88) + `<g fill="#efe4c5" stroke="#bba581" stroke-width="1.4"><path d="M150 143v-27h7v27Zm24-9v-27h7v27ZM146 114l39-13v7l-39 13Z"/><path d="m147 142 13-4v5l-13 4m23-14 14-4v5l-14 4"/></g>`; break;
    default: scene = terrace("#d7c69d") + rock(168, 93, .85) + building("keep", 86, 17, 140) + building("tower", 25, 66, 91) + building("gate", 82, 91, 92) + building("siegeWorkshop-model", 10, 112, 85) + flag(58, 68, "#188c84") + flag(174, 40, "#b4473f") + `<path d="m96 149 26 9 48-19" fill="none" stroke="#eddec1" stroke-width="3"/>`;
  }
  return `<svg class="journey-landmark" data-landmark="${theme}" viewBox="0 0 240 180" aria-hidden="true" focusable="false">${scene}</svg>`;
}

export function journeyMap(): string {
  return `<svg class="journey-map-art" viewBox="0 0 900 480" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M-30 91Q91 1 236 64T493 41 934 68M-40 110Q100 16 240 85T501 62 932 87M-40 132Q101 42 244 104T510 82 942 106M-10 400Q135 320 261 392T535 405 949 382M-10 422Q142 344 268 413T541 426 949 403" fill="none" stroke="#bbaa7f" stroke-width="1.4" opacity=".24"/>
    <path d="M889-10C780 40 847 141 786 195S717 290 799 359 760 451 824 495" fill="none" stroke="#80ada3" stroke-width="22" opacity=".2"/>
    <path d="M150 150C250 93 355 98 450 150S639 97 750 150C848 202 848 292 750 350S543 403 450 350 254 403 150 350" fill="none" stroke="#fff9e9" stroke-width="10"/>
    <path d="M150 150C250 93 355 98 450 150S639 97 750 150C848 202 848 292 750 350S543 403 450 350 254 403 150 350" fill="none" stroke="#a98b58" stroke-width="2.5" stroke-dasharray="3 9" stroke-linecap="round"/>
    <g fill="#a98b58"><path d="m305 111 9 4-9 4Zm300 15 9-4-9-4ZM819 247l-4 9-4-9ZM599 383l-9-4 9-4ZM300 383l-9-4 9-4Z"/></g>
    <g transform="translate(55 246)" stroke="#a69670" fill="none" opacity=".55"><circle r="18"/><path d="M0-25V25M-25 0h50"/><path d="m0-19 5 19-5-4-5 4Z" fill="#a69670"/></g>
  </svg>`;
}
