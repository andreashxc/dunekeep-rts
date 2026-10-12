import type { BuildingKind, MapTheme, ResourceKey } from "../game/types";

export type UIIcon = ResourceKey | "population" | "build" | "castle" | "flag" | "camera" | "top" | "rotateLeft" | "rotateRight" | "close" | "chevron" | "arrow" | "sound" | "muted" | "pause" | "play" | "restart" | "book" | "shield" | "sun" | "spear" | "bow" | "horse" | "catapult" | "ram" | "dance" | "leaf" | "check" | "plus" | "minus" | "up" | "down" | "left" | "right" | "tools" | "trophy";

/** Original vectors: the same small, readable symbols at every UI scale. */
export function icon(name: UIIcon, className = ""): string {
  const drawings: Record<UIIcon, string> = {
    wood: '<path fill="#9a663d" stroke="#6b4a31" d="m4 8 12-2 4 3v7l-12 2-4-3z"/><path fill="#c79862" stroke="#6b4a31" d="m4 8 4 3v7l-4-3z"/><path d="m8 11 12-2M11 13l6-1M11 16l7-1" stroke="#dab380"/>',
    stone: '<path fill="#a6afb0" stroke="#778786" d="m3 16 3-8 8-3 7 7-3 7-10 1z"/><path fill="#d9dcd0" d="m6 8 8-3-3 9-8 2z"/><path fill="#bec5bb" d="m14 5 7 7-10 2z"/>',
    food: '<path fill="#be8244" stroke="#93602e" d="M3 15c0-6 6-9 11-9s8 6 6 10-15 6-17-1Z"/><path d="m7 10 2 4m3-6 2 5m3-5 2 4" stroke="#f5d99d" stroke-width="2.4"/>',
    gold: '<circle cx="12" cy="12" r="9" fill="#e3b951" stroke="#b98932"/><circle cx="12" cy="12" r="6.3" fill="none" stroke="#fae4a3"/><path d="m12 7 1.5 3.2 3.5.5-2.5 2.5.6 3.5-3.1-1.6-3.1 1.6.6-3.5L7 10.7l3.5-.5Z" fill="#fff0bd" stroke="none"/>',
    grain: '<path d="M12 21V5m0 8-6-5m6 9 6-5" stroke="#9c8145"/><path fill="#cfad52" stroke="#ad873e" d="M12 8C7 7 7 3 9 2c3 1 4 3 3 6Zm0 5C7 13 3 10 4 7c4 0 7 2 8 6Zm0 5c4-1 8-3 8-7-4 0-7 2-8 7Zm0-7c5-2 7-5 5-8-4 1-5 4-5 8Z"/>',
    iron: '<path fill="#657f85" stroke="#415e67" d="m6 6 9-2 6 8-5 8-11-2-3-7z"/><path fill="#9cb9b6" d="m6 6 9-2-3 9-10-2z"/><path fill="#bfa57c" d="m8 15 3-2 2 5-4 1z"/>',
    weapons: '<path d="m7 18 11-13 2-1v4L10 20M4 16l6 5M5 20l2-2" stroke="#608588" stroke-width="2.1"/><path d="m5 4 4 2 10 12M4 8l2-4M15 20l5-5" stroke="#c1944e" stroke-width="2"/>',
    population: '<circle cx="9" cy="7" r="3.2" fill="#658f89" stroke="none"/><circle cx="17" cy="9" r="2.5" fill="#aa9471" stroke="none"/><path d="M2 20v-3a7 7 0 0 1 14 0v3Z" fill="#658f89" stroke="none"/><path d="M17 20v-3a9 9 0 0 0-1.4-4.8A5 5 0 0 1 22 17v3Z" fill="#aa9471" stroke="none"/>',
    build: '<path d="m4 20 8-9m-5-7 4-2 7 7-3 3-7-7m7 11 5 5m-3-8 3 3-4 4-3-3"/>',
    castle: '<path d="M4 21V9H2V3h4v3h4V3h4v3h4V3h4v6h-2v12M4 11h16M9 21v-6a3 3 0 0 1 6 0v6M2 21h20"/>',
    flag: '<path d="M5 22V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0"/><path d="M2 22h7"/>',
    camera: '<path d="m12 3 7 4v9l-7 4-7-4V7Zm0 0v8m7-4-7 4-7-4m7 4v9"/><path d="M2 6V3h3m14 0h3v3M2 18v3h3m14 0h3v-3"/>',
    top: '<path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/>',
    rotateLeft: '<path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/>',
    rotateRight: '<path d="M21 10a9 9 0 1 0-2 8m2-15v7h-7"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    sound: '<path d="m4 9 4 0 5-5v16l-5-5H4Zm12-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16"/>',
    muted: '<path d="m4 9 4 0 5-5v16l-5-5H4Zm13 0 5 6m0-6-5 6"/>',
    pause: '<path d="M7 5h3v14H7zm7 0h3v14h-3z" fill="currentColor" stroke="none"/>',
    play: '<path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none"/>',
    restart: '<path d="M4 9a9 9 0 1 1 0 7m0-14v7h7m1-2v6l4 2"/>',
    book: '<path d="M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Zm9 2v15M6 8h3m-3 4h3m6-4h3m-3 4h3"/>',
    shield: '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Zm0 4v11m-4-7h8"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    spear: '<path d="m5 22 12-17m-1-4 5 1-2 7-5-4Z"/><path d="m4 9-2 1v7l4 4 4-4v-7L6 8Z" fill="#7caaa1"/>',
    bow: '<path d="M6 2c16 5 16 15 0 20l6-10ZM3 12h18m-3-3 3 3-3 3"/>',
    horse: '<path d="m6 21 1-8 7-7-1-4 5 3 3 8-5 2-3-2-3 8Zm9-12h.1M4 21h13"/>',
    catapult: '<circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="18" r="2.5"/><path d="M5 16h14L16 9H8Zm7-7V3m0 0 7 3m-7-3-3 8"/><circle cx="19" cy="6" r="1.5"/>',
    ram: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M4 16V9l4-4h8l4 4v7M7 12h12m-12 0 8-3 5 3M5 7h14"/>',
    dance: '<circle cx="13" cy="4" r="2"/><path d="m12 7-3 5 3 3-2 7m2-10 4 3 4-2M9 12 4 9m8 6 4 6"/><path d="M4 5c1-2 3-3 5-3M18 5c2 1 3 2 3 4" stroke-dasharray="2 2"/>',
    leaf: '<path d="M20 3C9 1 3 8 5 16c8 4 17-3 15-13ZM3 22 16 8m-9 10-1-7m5 3 6 1"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    plus: '<path d="M5 12h14m-7-7v14"/>',
    minus: '<path d="M5 12h14"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>',
    left: '<path d="m14 6-6 6 6 6"/>',
    right: '<path d="m10 6 6 6-6 6"/>',
    tools: '<path d="m4 20 8-8m-3-8a6 6 0 0 0 8 8l4 4-5 5-4-4M9 4l4 4 3-3-4-4"/>',
    trophy: '<path d="M7 3h10v6c0 5-10 5-10 0Zm0 2H3v4c0 3 3 4 5 4m9-8h4v4c0 3-3 4-5 4m-4 1v6m-5 1h10m-8-3h6"/>',
  };
  return `<svg class="ui-icon ui-icon--${name} ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${drawings[name]}</svg>`;
}

export const buildingPurpose: Record<BuildingKind, string> = {
  keep: "Сердце крепости", house: "Место для 4 жителей", lumber: "Дерево для города", quarry: "Камень для стен", farm: "Финики к столу", wheatFarm: "Зерно для пекарни", mill: "Помол для пекарен", bakery: "Зерно становится хлебом", ironMine: "Добыча железа", blacksmith: "Оружие для гарнизона", well: "Вода и плодородие", granary: "Запасы и урожай", market: "Караванный обмен", tower: "Защита по выбранному модулю", wall: "Непрерывная оборона", gate: "Проход в укреплениях", barracks: "Копейщики и мечники", archery: "Обучение лучников", stable: "Тяжёлая конница", siegeWorkshop: "Катапульты и тараны",
};

function buildingFallback(kind: BuildingKind): string {
  const isWall = kind === "wall" || kind === "gate";
  const isFort = isWall || kind === "keep" || kind === "tower";
  const farming = kind === "farm" || kind === "wheatFarm";
  const base = '<ellipse cx="64" cy="80" rx="42" ry="9" fill="#638b8530"/>';
  const walls = '<path d="m32 37 35-14 30 16v35L63 89 32 72Z" fill="#d5bd90"/><path d="m32 37 31 16v36L32 72Z" fill="#eadab9"/><path d="m63 53 34-14v35L63 89Z" fill="#c9b184"/><path d="m32 37 35-14 30 16-34 14Z" fill="#fff3d7"/>';
  const roof = '<path d="m24 41 42-25 41 28-43 21Z" fill="#ac664b"/><path d="m24 41 40 24 2-49Z" fill="#c7805a"/><path d="m63 61 38-18-1 5-37 18Z" fill="#864c38"/>';
  const crenels = '<path d="m31 38 1-10 9 5v6l8 4v-6l9 5v6l9 3v-7l9-4v7l9-4v-6l10-4v11L63 59Z" fill="#f4e7c8"/><path d="M66 28V5m0 0 18 4v13l-18-5" stroke="#3b716d" stroke-width="2" fill="#3c9992"/>';
  const field = '<path d="m15 59 49-27 49 29-49 29Z" fill="#ad9562"/><path d="m20 58 44-22 43 25-43 24Z" fill="#d2b16d"/>' + [0, 1, 2, 3, 4].map(row => `<path d="m${31 + row * 10} ${53 + row * 5} 27-14" stroke="${kind === "wheatFarm" ? "#e8ca73" : "#69925c"}" stroke-width="6"/>`).join("");
  const extra = kind === "mill" ? '<g stroke="#8e7754" stroke-width="3"><path d="M63 13v70M30 48h66"/><path d="M52 16h10v24H52Zm13 37h10v24H65ZM33 37h24v10H33Zm37 12h24v10H70" fill="#fcf0d4" stroke-width="1.5"/></g>' : kind === "well" ? '<path d="M38 63V25m52 38V25M32 28l64-5" stroke="#96724a" stroke-width="5"/><path d="M64 26v31" stroke="#907751" stroke-width="2"/>' : "";
  return `<svg class="building-portrait__fallback" viewBox="0 0 128 100" aria-hidden="true" focusable="false">${base}${farming ? field : walls + (isFort ? crenels : roof)}${extra}</svg>`;
}

/** Portraits rendered offline from the same building factories used on the map. */
export function buildingPortrait(kind: BuildingKind, className = ""): string {
  const file = kind === "siegeWorkshop" ? "siegeWorkshop-model" : kind;
  return `<span class="building-portrait ${className}" data-portrait="${kind}">${buildingFallback(kind)}<img class="building-portrait__image" src="${import.meta.env.BASE_URL}assets/ui/buildings/${file}.png" alt="" loading="lazy" decoding="async" draggable="false" data-building-image></span>`;
}

export function landmark(theme: MapTheme): string {
  const shell = (ground: string, drawing: string, className = ""): string =>
    `<svg class="landmark-art ${className}" data-landmark="${theme}" viewBox="0 0 128 100" aria-hidden="true" focusable="false"><ellipse cx="64" cy="88" rx="53" ry="8" fill="#4f665b24"/>${ground}${drawing}</svg>`;
  if (theme === "oasis") return shell(
    '<path d="m8 61 50-36 63 28-6 29-55 13-49-19Z" fill="#b6c68f"/><path d="m8 61 50-31 63 23-61 27Z" fill="#ead099"/><ellipse cx="36" cy="62" rx="21" ry="10" fill="#64a99f"/><ellipse cx="36" cy="59" rx="14" ry="6" fill="#a9d1bb"/><path d="m10 78 51-22 53 22-55 15Z" fill="#d6b86e"/><path d="m21 77 39-17m-29 23 39-18m-26 22 37-16" stroke="#779a66" stroke-width="4"/>',
    '<path d="M20 66 27 37" stroke="#8f6541" stroke-width="4"/><path d="m27 36-16 7 5-11 12-3 15 9-12-1-5 12Z" fill="#4e886f"/><g transform="translate(69 36)"><path d="m0 18 16-8 21 10v25L18 54 0 44Z" fill="#e8d8b3"/><path d="m18 28 19-8v25l-19 9Z" fill="#bd9f72"/><path d="m-2 17 2-8 6 3v5l7 3v-6l7 3v6l7-3v-5l7-3v6l6-2v10l-22 7Z" fill="#fff2d2"/><path d="M13 48V33c0-4 7-3 7 2v10" fill="#3d837c"/><path d="M21 18V-4" stroke="#64503d" stroke-width="2"/><path d="m22-3 15 4v10L22 8Z" fill="#238d87"/></g><circle cx="54" cy="72" r="7" fill="#f2ddaa" stroke="#a18457" stroke-width="3"/><path d="M48 72h12" stroke="#6ba99a" stroke-width="3"/>',
  );
  if (theme === "red-canyon") return shell(
    '<path d="m7 59 15-36 19 12 9 43-31 10Zm112-2-12-39-21 13-8 47 31 8Z" fill="#a95f47"/><path d="m22 23 19 12-13 13-21 11m100-41-21 13 14 12 19 14" fill="#d99068"/><path d="m30 68 34-18 36 18-36 24Z" fill="#d8ac77"/><path d="m36 70 28-14 29 14-29 16Z" fill="#edc794"/>',
    '<g fill="#f3dfbb"><path d="M38 68V40h17v34Z"/><path d="M73 74V40h17v28Z"/><path d="M51 71V53h26v22Z"/></g><g fill="#fff0d0"><path d="M35 42v-8h6v4h5v-4h12v8Z"/><path d="M70 42v-8h6v4h5v-4h12v8Z"/><path d="M49 55v-7h7v4h7v-4h8v4h8v7Z"/></g><path d="M59 75V61c0-7 10-7 10 0v14" fill="#874d3e"/><path d="M65 49V21" stroke="#654739" stroke-width="2.5"/><path d="m66 22 17 5v11l-17-4Z" fill="#268b84"/><path d="M44 78h41" stroke="#9b6449" stroke-width="4"/>',
  );
  if (theme === "salt-flat") return shell(
    '<path d="m8 61 49-32 64 25-7 29-55 12-49-18Z" fill="#c7ccbb"/><path d="m8 61 49-27 64 20-62 27Z" fill="#eee4c8"/><path d="m12 72 18-35 12 21 9-29 14 38 15-25 16 33" fill="#fff9e8" opacity=".94"/><path d="m22 66 9-25 6 22m16-3 8-22 9 30m17 3 7-21 6 25" stroke="#d7ddce" stroke-width="3" fill="none"/>',
    '<path d="m50 56 18-13 20 13v24H50Z" fill="#e4c58c"/><path d="m47 57 21-21 23 21Z" fill="#a95f4b"/><path d="m55 59 13-13 15 13Z" fill="#d28361"/><path d="M64 80V64h9v16" fill="#628f85"/><path d="M69 39V22" stroke="#695039" stroke-width="2"/><path d="m70 23 14 4v9l-14-3Z" fill="#2b9188"/><g fill="#9e6f4c"><path d="M24 76c0-8 6-13 12-8l4 6 7 2-3 4H25Z"/><circle cx="30" cy="80" r="3"/><circle cx="41" cy="80" r="3"/></g><path d="m19 68 7-5m18 8 5-4" stroke="#72523d" stroke-width="2"/>',
  );
  if (theme === "river-valley") return shell(
    '<path d="m7 56 51-31 63 26-7 32-55 12-50-18Z" fill="#88aa78"/><path d="m7 56 51-26 63 21-62 29Z" fill="#d9cd8d"/><path d="M67 26c-17 13 7 19-3 31S50 75 58 91" fill="none" stroke="#67aaa2" stroke-width="15"/><path d="M67 26c-13 14 8 18-2 31S53 74 59 91" fill="none" stroke="#9bd0bc" stroke-width="5"/><path d="M47 56h36l4 8H43Z" fill="#a7764d"/><path d="M48 57h34M51 61h31" stroke="#e5c58f" stroke-width="2"/>',
    '<g transform="translate(13 43)"><path d="M0 16 14 9l17 8v22l-16 8L0 38Z" fill="#f3e6c7"/><path d="m15 26 16-9v22l-16 8Z" fill="#bca477"/><path d="M-2 16V9l6 3V8l7 4V8l7 4 7-3v5l8-3v9l-18 10Z" fill="#fff4dc"/><path d="M16 11V-7" stroke="#5e4d3e" stroke-width="2"/><path d="m17-6 13 4v9L17 4Z" fill="#258c84"/></g><g transform="translate(84 39)"><path d="M0 18 14 11l18 9v23l-16 8L0 41Z" fill="#d2ac7f"/><path d="m16 29 16-9v23l-16 8Z" fill="#9c7557"/><path d="M-2 18v-8l7 3V9l7 4V9l7 4 7-3v5l8-3v10L16 32Z" fill="#ead1aa"/><path d="M15 13V-7" stroke="#5e4438" stroke-width="2"/><path d="m16-6 14 4v9L16 4Z" fill="#b55e47"/></g><path d="m56 48 8-6 8 6" stroke="#f4e4b9" stroke-width="2"/>',
    "landmark-art--duel",
  );
  if (theme === "ancient-ruins") return shell(
    '<path d="m7 59 50-33 64 25-7 33-56 11L9 77Z" fill="#858f6f"/><path d="m7 59 50-28 64 20-63 30Z" fill="#d6bd88"/><ellipse cx="63" cy="65" rx="25" ry="10" fill="#7da996"/><ellipse cx="63" cy="64" rx="17" ry="6" fill="#aed0ad"/><path d="M12 76 54 55m20 4 39 18M59 31v53" stroke="#ead7ad" stroke-width="5" opacity=".75"/>',
    '<g fill="#f1e4c5"><path d="M19 69V40h7v29m10 0V40h7v29M16 37h30v6H16Zm1 34h28v6H17Z"/><path d="M88 72V37h7v35m10 0V37h7v35M85 34h30v6H85Zm1 40h28v6H86Z"/></g><g transform="translate(37 42)"><path d="M0 18 12 12l14 7v20l-13 7L0 38Z" fill="#f3e3c2"/><path d="m13 27 13-8v20l-13 7Z" fill="#b99a70"/><path d="M-2 18v-7l6 3v-5l7 4v-4l7 4 6-3v8l-11 12Z" fill="#fff1d0"/><path d="M13 14V-3" stroke="#604d3b" stroke-width="2"/><path d="m14-2 11 4v8L14 7Z" fill="#248c83"/></g><g transform="translate(72 47)"><path d="M0 17 12 11l15 8v20l-13 7L0 38Z" fill="#d4b183"/><path d="m14 27 13-8v20l-13 7Z" fill="#9c785a"/><path d="M-2 17v-7l6 3V9l7 4V9l7 4 7-3v10l-11 10Z" fill="#e9cfaa"/><path d="M13 13V-5" stroke="#604638" stroke-width="2"/><path d="m14-4 12 4v8L14 5Z" fill="#b65d46"/></g><path d="m58 39 14 15m-1-16L57 54" stroke="#826346" stroke-width="3"/>',
    "landmark-art--duel",
  );
  return shell(
    '<path d="m4 55 54-37 66 31-7 37-58 11L7 77Z" fill="#56685f"/><path d="m4 55 54-31 66 25-65 33Z" fill="#cfb47f"/><circle cx="64" cy="48" r="29" fill="#f3d67a" opacity=".38"/><circle cx="64" cy="48" r="21" fill="none" stroke="#fff0ae" stroke-width="3" opacity=".58"/><path d="M64 14v10M35 24l8 8m50-8-8 8M25 48h12m54 0h12" stroke="#f7dfa0" stroke-width="3"/>',
    '<g transform="translate(8 36)"><path d="M0 20 16 11l23 11v31l-20 10L0 51Z" fill="#f3e4c3"/><path d="m19 34 20-12v31L19 63Z" fill="#bca074"/><path d="M-2 20v-9l7 4V9l8 5V8l8 5 8-4v6l9-4v14L19 38Z" fill="#fff4d8"/><path d="M3 15V2h8v15m18 1V1h8v20" fill="#fff0d0"/><path d="M9 12V-10" stroke="#59493a" stroke-width="2.5"/><path d="m10-9 17 5v11L10 3Z" fill="#188c84"/><path d="M15 56V40c0-6 9-6 9 0v12" fill="#387a72"/></g><g transform="translate(80 34)"><path d="M0 22 15 13l24 11v31L19 65 0 53Z" fill="#d0a579"/><path d="m19 36 20-12v31L19 65Z" fill="#90694e"/><path d="M-2 22v-9l7 4v-6l8 5v-6l8 5 8-4v6l9-4v14L19 40Z" fill="#e8c9a0"/><path d="M2 17V3h9v16m18 1V1h8v22" fill="#e5c39a"/><path d="M10 14V-10" stroke="#553d35" stroke-width="2.5"/><path d="m11-9 18 5v11L11 3Z" fill="#b4473f"/><path d="M15 58V42c0-6 9-6 9 0v12" fill="#704a42"/></g><path d="m54 47 20 22m0-22L54 69" stroke="#fff0bd" stroke-width="4"/><path d="m50 43 7 1-3 6m24-7-7 1 3 6" fill="#fff0bd"/><path d="M48 77h32" stroke="#674d3f" stroke-width="4"/><circle cx="64" cy="58" r="4" fill="#f4c65d"/>',
    "landmark-art--duel landmark-art--final",
  );
}

/** Decorative atlas, separate from the six real, accessible mission buttons. */
export function campaignAtlas(): string {
  return `<svg class="campaign-atlas" viewBox="0 0 900 480" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M-50 105C114-54 327 133 476 42S739-9 934 71V500H-50Z" fill="#ead5a5"/>
    <path d="M-30 435C194 321 215 450 399 352S645 254 937 351V500H-30Z" fill="#dfc692" opacity=".58"/>
    <path d="M-30 105C193-29 298 116 460 51M121 422c140-75 201 31 354-48M561 71c103-54 236-44 351 18M-30 281c120-70 180 43 291-8M533 268c100-35 212-10 363 27" stroke="#caae78" stroke-width="2" fill="none" opacity=".4"/>
    <path d="M902 2C776 128 729 84 653 153S734 256 612 304 685 422 553 486" stroke="#98bda2" stroke-width="39" fill="none" opacity=".55"/>
    <path d="M902 2C776 128 729 84 653 153S734 256 612 304 685 422 553 486" stroke="#6aa89e" stroke-width="17" fill="none"/>
    <path d="M144 145C244 73 335 133 450 144S636 104 753 145C871 215 844 275 753 337S559 293 450 337 263 391 144 337" stroke="#fff5d7" stroke-width="9" stroke-linecap="round" fill="none" opacity=".8"/>
    <path d="M144 145C244 73 335 133 450 144S636 104 753 145C871 215 844 275 753 337S559 293 450 337 263 391 144 337" stroke="#a58b60" stroke-width="2.5" stroke-dasharray="3 10" stroke-linecap="round" fill="none" opacity=".8"/>
    <g fill="#c9ad7b" opacity=".65"><path d="m35 190 14-26 18 34Z"/><path d="m55 205 21-35 25 41Z"/><path d="m783 67 17-26 13 33Z"/><path d="m303 301 16-29 22 32Z"/><path d="m52 390 14-26 18 34Z"/><path d="m317 64 16-29 22 32Z"/></g>
    <g transform="translate(831 414)" stroke="#987d50" fill="none" opacity=".7"><circle r="20"/><path d="M0-29V29M-29 0h58m-36-8 16 16m-16 0L8-8"/><path d="m0-20 6 20-6-5-6 5Z" fill="#987d50"/></g>
  </svg>`;
}
