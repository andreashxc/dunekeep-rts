import type {
  ArmyUnitDefinition,
  ArmyUnitKind,
  BuildingCategory,
  BuildingDefinition,
  BuildingKind,
  DifficultyDefinition,
  DifficultyId,
  MissionDefinition,
  MissionId,
  RationPolicy,
  RationPolicyDefinition,
  ResourceKey,
  StockpiledResourceKey,
  StorageCapacity,
  TaxPolicy,
  TaxPolicyDefinition,
} from "./types";

export const GRID_SIZE = 18;
export const TILE_SIZE = 1.25;
export const ECONOMY_TICK_SECONDS = 2;
export const RESOURCE_KEYS: ResourceKey[] = ["wood", "stone", "food", "gold", "grain", "iron", "weapons"];
export const STOCKPILE_KEYS: StockpiledResourceKey[] = ["wood", "stone", "food", "grain", "iron", "weapons"];

export const DIFFICULTIES: Record<DifficultyId, DifficultyDefinition> = {
  relaxed: {
    id: "relaxed", label: "Спокойно",
    description: "+25% начальных запасов и больше времени на развитие. Противников меньше, они слабее. Для спокойного строительства.",
    startingResourceMultiplier: 1.25, waveTimeMultiplier: 1.35,
    enemyHpMultiplier: 0.82, enemyDamageMultiplier: 0.78, enemyCountMultiplier: 0.8,
  },
  standard: {
    id: "standard", label: "Обычно",
    description: "Ресурсы требуют расчёта, а события развиваются быстрее. Подходит после знакомства с игрой.",
    startingResourceMultiplier: 1, waveTimeMultiplier: 0.92,
    enemyHpMultiplier: 1.08, enemyDamageMultiplier: 1.1, enemyCountMultiplier: 1.1,
  },
  veteran: {
    id: "veteran", label: "Сложно",
    description: "−18% начальных запасов. События развиваются заметно быстрее, соперники крепче и опаснее.",
    startingResourceMultiplier: 0.82, waveTimeMultiplier: 0.78,
    enemyHpMultiplier: 1.25, enemyDamageMultiplier: 1.3, enemyCountMultiplier: 1.25,
  },
};
export const DIFFICULTY_LIST = [DIFFICULTIES.relaxed, DIFFICULTIES.standard, DIFFICULTIES.veteran];

export const TRADE_RATES: Record<StockpiledResourceKey, { lot: number; buy: number; sell: number; label: string }> = {
  wood: { lot: 20, buy: 18, sell: 12, label: "дерево" },
  stone: { lot: 15, buy: 22, sell: 14, label: "камень" },
  food: { lot: 20, buy: 16, sell: 9, label: "еду" },
  grain: { lot: 15, buy: 15, sell: 9, label: "зерно" },
  iron: { lot: 8, buy: 22, sell: 13, label: "железо" },
  weapons: { lot: 3, buy: 27, sell: 16, label: "оружие" },
};

export const TAX_POLICIES: Record<TaxPolicy, TaxPolicyDefinition> = {
  none: {
    id: "none", label: "Без налога", description: "Нет дохода, зато жители быстрее возвращают доверие.",
    goldPerCivilian: 0, popularityPerTick: 0.2,
  },
  standard: {
    id: "standard", label: "Обычный сбор", description: "Умеренный доход почти без ущерба для настроения.",
    goldPerCivilian: 0.12, popularityPerTick: -0.04,
  },
  high: {
    id: "high", label: "Повышенный сбор", description: "Много золота сейчас, но недовольство быстро растёт.",
    goldPerCivilian: 0.28, popularityPerTick: -0.32,
  },
};

export const RATION_POLICIES: Record<RationPolicy, RationPolicyDefinition> = {
  half: {
    id: "half", label: "Половинный паёк", description: "Экономит еду, замедляет приток семей и снижает доверие.",
    foodMultiplier: 0.65, popularityPerTick: -0.3, growthInterval: 30,
  },
  normal: {
    id: "normal", label: "Обычный паёк", description: "Сбалансированный расход еды и настроение жителей.",
    foodMultiplier: 1, popularityPerTick: 0.06, growthInterval: 20,
  },
  double: {
    id: "double", label: "Двойной паёк", description: "Дорого, но быстро повышает доверие и привлекает семьи.",
    foodMultiplier: 1.6, popularityPerTick: 0.32, growthInterval: 15,
  },
};

export const BASE_STORAGE_CAPACITY: StorageCapacity = { wood: 320, stone: 300, food: 180, grain: 90, iron: 70, weapons: 40 };
export const GRANARY_STORAGE_BONUS = 140;
export const GRANARY_GRAIN_BONUS = 100;
export const MARKET_STORAGE_BONUS: Pick<StorageCapacity, "wood" | "stone" | "iron" | "weapons"> = { wood: 160, stone: 140, iron: 60, weapons: 30 };

export const BUILDINGS: Record<BuildingKind, BuildingDefinition> = {
  keep: {
    kind: "keep", category: "fortress", name: "Цитадель", shortName: "Цитадель", icon: "♜",
    description: "Сердце поселения. Если цитадель падёт — игра окончена.", cost: {}, maxHp: 1200,
  },
  house: {
    kind: "house", category: "economy", name: "Глинобитный дом", shortName: "Дом", icon: "⌂",
    description: "+4 места для жителей и +3 надежды.", cost: { wood: 35, stone: 10 }, maxHp: 150, hotkey: "1",
  },
  lumber: {
    kind: "lumber", category: "economy", name: "Двор лесоруба", shortName: "Лесоруб", icon: "♣",
    description: "1 рабочий. До 140% выхода дерева рядом с рощей; дерево нужно также пекарне и кузнецу.", cost: { wood: 22, stone: 8 }, maxHp: 150, hotkey: "2", workers: 1,
    production: { outputs: { wood: 3.2 } },
  },
  quarry: {
    kind: "quarry", category: "economy", name: "Каменоломня", shortName: "Карьер", icon: "◆",
    description: "1 рабочий. До 140% добычи камня у скал. Обеспечивает стены, башни и ремонт.", cost: { wood: 28, stone: 5 }, maxHp: 170, hotkey: "3", workers: 1,
    production: { outputs: { stone: 2.8 } },
  },
  farm: {
    kind: "farm", category: "economy", name: "Финиковая ферма", shortName: "Ферма", icon: "❦",
    description: "1 рабочий. Сразу даёт еду. Плодородная земля, колодец и амбар увеличивают урожай.", cost: { wood: 30, stone: 5 }, maxHp: 140, hotkey: "4", workers: 1,
    production: { outputs: { food: 3.4 } },
  },
  wheatFarm: {
    kind: "wheatFarm", category: "economy", name: "Пшеничное поле", shortName: "Пшеница", icon: "♧",
    description: "1 рабочий. Выращивает зерно; колодец и плодородная земля улучшают урожай. Зерно само по себе не съедобно.",
    cost: { wood: 38, stone: 6 }, maxHp: 135, workers: 1, production: { outputs: { grain: 3 } },
  },
  mill: {
    kind: "mill", category: "economy", name: "Ветряная мельница", shortName: "Мельница", icon: "✣",
    description: "1 рабочий. Обслуживает все пекарни в радиусе 4 клеток. Без работающей мельницы они остановятся.",
    cost: { wood: 46, stone: 24 }, maxHp: 210, workers: 1,
  },
  bakery: {
    kind: "bakery", category: "economy", name: "Общинная пекарня", shortName: "Пекарня", icon: "◒",
    description: "1 рабочий. Каждые 2 с: 2 зерна + 0,5 дерева → 14 еды. Нужна работающая мельница не дальше 4 клеток.",
    cost: { wood: 38, stone: 28 }, maxHp: 200, workers: 1,
    production: { inputs: { grain: 2, wood: 0.5 }, outputs: { food: 14 }, requires: "mill", supportRadius: 4 },
  },
  ironMine: {
    kind: "ironMine", category: "economy", name: "Железный рудник", shortName: "Рудник", icon: "⬡",
    description: "1 рабочий. Добывает железо. Стройте в пределах 4 клеток от железной жилы.",
    cost: { wood: 40, stone: 20 }, maxHp: 210, workers: 1, production: { outputs: { iron: 1.6 } },
  },
  blacksmith: {
    kind: "blacksmith", category: "military", name: "Оружейная кузница", shortName: "Кузница", icon: "⚒",
    description: "2 рабочих. Каждые 2 с: 2 железа + 1 дерево → 1 оружие для мечников и мамлюков.",
    cost: { wood: 48, stone: 35, gold: 25 }, maxHp: 245, workers: 2,
    production: { inputs: { iron: 2, wood: 1 }, outputs: { weapons: 1 } },
  },
  well: {
    kind: "well", category: "economy", name: "Колодец общины", shortName: "Колодец", icon: "◉",
    description: "Без рабочих. +20% к финикам и пшенице в радиусе 4 клеток. Бойцы рядом восстанавливаются, пока поблизости нет врагов.",
    cost: { wood: 12, stone: 24 }, maxHp: 220,
  },
  granary: {
    kind: "granary", category: "economy", name: "Амбар оазиса", shortName: "Амбар", icon: "▤",
    description: "+25% к соседним финиковым фермам, +140 места для еды и +100 для зерна. Без рабочих.", cost: { wood: 45, stone: 20 }, maxHp: 240, hotkey: "5",
  },
  market: {
    kind: "market", category: "economy", name: "Караванный рынок", shortName: "Рынок", icon: "⚖",
    description: "1 рабочий. Обмен всех запасов и автопродажа излишков дерева/камня/еды. Расширяет склады.", cost: { wood: 50, stone: 25, gold: 20 }, maxHp: 210, hotkey: "6", workers: 1,
  },
  tower: {
    kind: "tower", category: "fortress", name: "Оборонная башня", shortName: "Башня", icon: "♝",
    description: "Сама не стреляет. Поднимите лучника или установите лёгкий либо тяжёлый модуль защиты.", cost: { wood: 45, stone: 65, gold: 22 }, maxHp: 420, hotkey: "7",
  },
  wall: {
    kind: "wall", category: "fortress", name: "Крепостная стена", shortName: "Стена", icon: "▥",
    description: "Соединяется с соседними стенами, башнями и воротами.", cost: { stone: 14 }, maxHp: 390, hotkey: "8",
  },
  gate: {
    kind: "gate", category: "fortress", name: "Надвратная башня", shortName: "Ворота", icon: "Π",
    description: "Прочный проход в контуре стены; враги должны разрушить его.", cost: { wood: 22, stone: 38 }, maxHp: 560, hotkey: "9",
  },
  barracks: {
    kind: "barracks", category: "military", name: "Казармы гарнизона", shortName: "Казармы", icon: "♠",
    description: "Обучает копейщиков и тяжёлых мечников из свободных жителей. Мечникам нужно оружие кузницы.", cost: { wood: 55, stone: 35, gold: 25 }, maxHp: 280,
  },
  archery: {
    kind: "archery", category: "military", name: "Стрельбище", shortName: "Стрельбище", icon: "➶",
    description: "Обучает лучников для прикрытия пехоты с дальних позиций.", cost: { wood: 65, stone: 25, gold: 30 }, maxHp: 240,
  },
  stable: {
    kind: "stable", category: "military", name: "Конюшня мамлюков", shortName: "Конюшня", icon: "♞",
    description: "Обучает тяжёлую конницу. Для снаряжения мамлюка нужно оружие и много продовольствия.", cost: { wood: 80, stone: 45, gold: 55 }, maxHp: 320,
  },
  siegeWorkshop: {
    kind: "siegeWorkshop", category: "military", name: "Осадный двор", shortName: "Осадный двор", icon: "◉",
    description: "Собирает катапульты и крытые тараны для похода на вражеские укрепления.",
    cost: { wood: 95, stone: 55, gold: 45 }, maxHp: 300,
  },
};

export const BUILD_CATEGORIES: Array<{ id: "all" | BuildingCategory; label: string }> = [
  { id: "all", label: "Все" },
  { id: "economy", label: "Хозяйство" },
  { id: "fortress", label: "Крепость" },
  { id: "military", label: "Армия" },
];

export const BUILDABLE_KINDS: BuildingKind[] = [
  "house", "lumber", "quarry", "farm", "granary", "market",
  "well", "wheatFarm", "mill", "bakery", "ironMine",
  "tower", "wall", "gate", "barracks", "archery", "blacksmith", "stable", "siegeWorkshop",
];

export const ARMY_UNITS: Record<ArmyUnitKind, ArmyUnitDefinition> = {
  spearman: {
    kind: "spearman", name: "Копейщик", shortName: "Копейщик", icon: "♠",
    description: "Недорогой защитник, особенно крепок у стен.", trainedAt: "barracks",
    cost: { food: 16, gold: 14 }, maxHp: 125, speed: 0.92, damage: 24, range: 0.62, cooldown: 0.9,
  },
  archer: {
    kind: "archer", name: "Лучник", shortName: "Лучник", icon: "➶",
    description: "Бьёт издалека, но уязвим в ближнем бою.", trainedAt: "archery",
    cost: { wood: 8, food: 12, gold: 22 }, maxHp: 82, speed: 0.82, damage: 18, range: 4.4, cooldown: 1.18,
  },
  swordsman: {
    kind: "swordsman", name: "Мечник", shortName: "Мечник", icon: "⚔",
    description: "Тяжёлая пехота: хорошая защита и урон, но медленное передвижение.", trainedAt: "barracks",
    cost: { weapons: 2, food: 18, gold: 26 }, maxHp: 225, speed: 0.72, damage: 37, range: 0.65, cooldown: 0.95,
  },
  knight: {
    kind: "knight", name: "Мамлюк", shortName: "Мамлюк", icon: "♞",
    description: "Быстрый тяжёлый всадник для перехвата элиты.", trainedAt: "stable",
    cost: { weapons: 3, food: 26, gold: 45 }, maxHp: 260, speed: 1.8, damage: 48, range: 0.72, cooldown: 1.05,
  },
  catapult: {
    kind: "catapult", name: "Полевая катапульта", shortName: "Катапульта", icon: "◉",
    description: "Медленное дальнобойное орудие. Особенно эффективно против стен, башен и цитадели.", trainedAt: "siegeWorkshop",
    cost: { wood: 70, stone: 34, iron: 10, gold: 48 }, maxHp: 340, speed: 0.48, damage: 28, range: 7.5, cooldown: 4.4,
    unitClass: "siege", allowedTargets: "buildings", populationCost: 2, buildingDamage: 145, minRange: 2.3,
  },
  batteringRam: {
    kind: "batteringRam", name: "Крытый таран", shortName: "Таран", icon: "▰",
    description: "Прочная машина ближнего боя. Ломает ворота и стены, но почти бесполезна против людей.", trainedAt: "siegeWorkshop",
    cost: { wood: 82, iron: 14, gold: 38 }, maxHp: 520, speed: 0.58, damage: 8, range: 0.82, cooldown: 1.7,
    unitClass: "siege", allowedTargets: "buildings", populationCost: 2, buildingDamage: 98,
  },
};

export const MISSIONS: Record<MissionId, MissionDefinition> = {
  oasis: {
    id: "oasis", order: 1, name: "Оазис Аль-Хадир", subtitle: "Первый этап",
    briefing: "Спокойно освойтесь в оазисе. Постройте ещё один источник еды, поставьте первую башню и обучите двух бойцов. Лишь затем отбейте один небольшой набег.", difficulty: "Просто",
    strategyHint: "Время стоит, пока вы не нажмёте «Начать игру». Добавьте ферму на светлой плодородной земле, постройте казармы и башню, затем обучите двух копейщиков.",
    theme: "oasis", goalKind: "tutorial", goalTarget: 4, goalLabel: "Новая ферма, башня, 2 бойца и один отражённый набег",
    startingResources: { wood: 245, stone: 215, food: 130, gold: 160, grain: 0, iron: 0, weapons: 0 }, startingPopulation: 8, startingPopulationCap: 12, startingHope: 86,
    keep: { gx: 8, gz: 8 }, resourceZones: { lumber: { gx: 2, gz: 14 }, quarry: { gx: 14, gz: 3 }, iron: { gx: 14, gz: 13 }, fertile: { gx: 7, gz: 11 } },
    startingBuildings: [{ kind: "house", gx: 7, gz: 9 }, { kind: "farm", gx: 9, gz: 9 }],
    waves: [
      { at: 260, count: 4, direction: "запад", hpScale: 0.72 },
    ],
    events: [
      { id: "oasis-neighbours", at: 70, title: "Помощь соседей", description: "Жители принесли еду и золото, чтобы первые бойцы успели подготовиться.", tone: "success", resources: { food: 34, gold: 28 }, hope: 4 },
      { id: "oasis-builders", at: 175, title: "Мастера оазиса", description: "До единственного набега ещё есть время. Мастера оставили дерево и камень для башни и стен.", tone: "success", resources: { wood: 48, stone: 42 } },
    ],
  },
  canyon: {
    id: "canyon", order: 2, name: "Красное ущелье", subtitle: "Два фронта",
    briefing: "Каменные проходы охраняют торговый путь, но роща и рудники далеко друг от друга. Сохраните добывающие дворы и соберите постоянный гарнизон.", difficulty: "Обычно",
    strategyHint: "Выносные производства уязвимы: стройте оборону у цитадели, а после первых волн обучайте гарнизон. Для победы должны выжить 5 бойцов.",
    theme: "red-canyon", goalKind: "army", goalTarget: 5, goalLabel: "Удержать гарнизон из 5 бойцов",
    startingResources: { wood: 190, stone: 165, food: 110, gold: 115, grain: 0, iron: 0, weapons: 0 }, startingPopulation: 9, startingPopulationCap: 14, startingHope: 74,
    keep: { gx: 9, gz: 8 }, resourceZones: { lumber: { gx: 3, gz: 3 }, quarry: { gx: 14, gz: 14 }, iron: { gx: 13, gz: 3 }, fertile: { gx: 6, gz: 11 } },
    startingBuildings: [{ kind: "house", gx: 8, gz: 9 }, { kind: "lumber", gx: 4, gz: 3 }, { kind: "farm", gx: 7, gz: 10 }],
    waves: [
      { at: 130, count: 5, direction: "север" },
      { at: 255, count: 7, direction: "юг", eliteEvery: 4, hpScale: 1.06, specialists: {kind: "archer", count: 2}, raidEconomy: true },
      { at: 385, count: 10, direction: "запад", eliteEvery: 4, hpScale: 1.12 },
      { at: 520, count: 12, direction: "восток", eliteEvery: 3, hpScale: 1.18 },
    ],
    events: [
      { id: "canyon-quarrymen", at: 65, title: "Каменщики перевала", description: "Мастера доставили камень и железо для укреплений.", tone: "success", resources: { stone: 40, iron: 12 }, population: 1 },
      { id: "canyon-raid-warning", at: 195, title: "Рейд на добычу", description: "Следующий отряд с лучниками нападёт на внешние производства. Прикройте дворы мобильным гарнизоном.", tone: "danger" },
      { id: "canyon-veterans", at: 305, title: "Стража каравана", description: "Два опытных копейщика остаются защищать ущелье. Подготовьте свободное жильё.", tone: "success", army: { kind: "spearman", count: 2 }, hope: 5 },
    ],
  },
  salt: {
    id: "salt", order: 3, name: "Соляной путь", subtitle: "Караванная корона",
    briefing: "Соль кормит торговцев, но не жителей. Переживите засуху, наладьте поставки хлеба и сохраните казну после пяти атак на караванную дорогу.", difficulty: "Сложно",
    strategyHint: "Рынок уже открыт. В засуху выгоднее покупать зерно и печь хлеб; не продавайте последний продовольственный запас.",
    theme: "salt-flat", goalKind: "wealth", goalTarget: 260, goalLabel: "Накопить 260 золота",
    startingResources: { wood: 170, stone: 150, food: 115, gold: 155, grain: 12, iron: 0, weapons: 2 }, startingPopulation: 8, startingPopulationCap: 12, startingHope: 70,
    keep: { gx: 8, gz: 9 }, resourceZones: { lumber: { gx: 14, gz: 4 }, quarry: { gx: 3, gz: 13 }, iron: { gx: 4, gz: 3 }, fertile: { gx: 11, gz: 7 } },
    startingBuildings: [{ kind: "house", gx: 7, gz: 8 }, { kind: "farm", gx: 9, gz: 8 }, { kind: "market", gx: 9, gz: 10 }],
    waves: [
      { at: 140, count: 5, direction: "восток" },
      { at: 260, count: 7, direction: "запад", eliteEvery: 5, hpScale: 1.05 },
      { at: 385, count: 9, direction: "север", eliteEvery: 4, hpScale: 1.1 },
      { at: 510, count: 11, direction: "юг", eliteEvery: 4, hpScale: 1.15 },
      { at: 640, count: 13, direction: "восток", eliteEvery: 3, hpScale: 1.2, specialists: {kind: "batteringRam", count: 1} },
    ],
    events: [
      { id: "salt-tolls", at: 70, title: "Пошлина караванов", description: "Купцы заплатили за охраняемую дорогу: золото и продовольствие поступили в казну.", tone: "success", resources: { gold: 45, food: 24 } },
      { id: "salt-drought", at: 185, title: "Сухой ветер", description: "На 80 секунд урожай фиников падает до 60%, пшеницы — до 84%. Пекарни продолжают работать как обычно.", tone: "danger", foodProductionMultiplier: 0.6, duration: 80 },
      { id: "salt-grain", at: 355, title: "Зерновой караван", description: "Через пустыню прошёл караван с зерном и лесом.", tone: "success", resources: { grain: 35, wood: 45 }, hope: 4 },
      { id: "salt-siege-warning", at: 525, title: "Таран на дороге", description: "В последнем набеге будет таран. Подготовьте пехоту или тяжёлый модуль башни.", tone: "danger" },
    ],
  },
  river: {
    id: "river", order: 4, name: "Долина двух рек", subtitle: "Удержать переправу",
    briefing: "За рекой появился молодой замок Нахр. Сосед хочет забрать обе переправы и дважды отправит к вам свои отряды. Удержите долину и сохраните шестерых бойцов.", difficulty: "Обычно",
    strategyHint: "Для победы отбейте два похода и сохраните шесть бойцов — штурмовать замок не нужно. Северная переправа под огнём башни. Для обхода используйте южную переправу и её внешний южный край, держась вдали от башни.",
    theme: "river-valley", goalKind: "duel", goalTarget: 8, goalLabel: "Отбить 2 похода и сохранить 6 бойцов",
    gridSize: 26,
    startingResources: { wood: 245, stone: 220, food: 170, gold: 180, grain: 18, iron: 8, weapons: 2 }, startingPopulation: 11, startingPopulationCap: 19, startingHope: 82,
    keep: { gx: 5, gz: 13 }, resourceZones: { lumber: { gx: 2, gz: 21 }, quarry: { gx: 9, gz: 3 }, iron: { gx: 8, gz: 23 }, fertile: { gx: 7, gz: 6 } },
    startingBuildings: [
      { kind: "house", gx: 7, gz: 11 }, { kind: "farm", gx: 7, gz: 8 }, { kind: "wheatFarm", gx: 8, gz: 6 },
      { kind: "well", gx: 6, gz: 7 }, { kind: "barracks", gx: 7, gz: 14 },
    ],
    waves: [],
    events: [
      { id: "river-crossing", at: 50, title: "Лодки на переправе", description: "Рыбаки доставили еду и дерево. Замок Нахр пока только собирает первый отряд.", tone: "success", resources: { food: 34, wood: 36 } },
      { id: "river-flood", at: 65, title: "Плодородный разлив", description: "На 100 секунд урожай полей и фиников увеличен на 35%.", tone: "success", foodProductionMultiplier: 1.35, duration: 100 },
      { id: "river-first-march", at: 115, title: "Движение за рекой", description: "Разведчики заметили подготовку первого похода. Башня у переправы выиграет время.", tone: "danger" },
      { id: "river-guardians", at: 205, title: "Защитники долины", description: "Два копейщика из соседней деревни присоединились к вам.", tone: "success", army: { kind: "spearman", count: 2 }, hope: 5 },
    ],
    duel: {
      enemyName: "Замок Нахр",
      objective: { kind: "hold-crossing", primaryTarget: 2, supportTarget: 6 },
      aiPace: 0.68,
      enemyKeep: { gx: 20, gz: 13 },
      enemyResourceZones: { lumber: { gx: 23, gz: 21 }, quarry: { gx: 23, gz: 4 }, iron: { gx: 17, gz: 23 }, fertile: { gx: 18, gz: 10 } },
      neutralZone: { minGx: 10, maxGx: 15, minGz: 0, maxGz: 25 },
      playerBuildArea: { minGx: 0, maxGx: 9, minGz: 0, maxGz: 25 },
      enemyBuildArea: { minGx: 16, maxGx: 25, minGz: 0, maxGz: 25 },
      enemyStartingResources: { wood: 175, stone: 145, food: 125, gold: 120, grain: 8, iron: 4, weapons: 0 },
      enemyStartingPopulation: 9,
      enemyStartingPopulationCap: 17,
      enemyStartingBuildings: [
        { kind: "house", gx: 19, gz: 15 }, { kind: "house", gx: 21, gz: 15 }, { kind: "farm", gx: 18, gz: 10 },
        { kind: "barracks", gx: 18, gz: 14 }, { kind: "tower", gx: 18, gz: 12, towerUpgrade: "light" },
        { kind: "wall", gx: 16, gz: 13 }, { kind: "gate", gx: 16, gz: 14 },
      ],
    },
  },
  ruins: {
    id: "ruins", order: 5, name: "Сады забытого эмира", subtitle: "Сломать укрепления",
    briefing: "Эмир Сафар занял сады и окружил двор стенами. Его замок быстро восстанавливается. Разрушьте пять укреплений и сохраните восемь единиц оружия для союза городов.", difficulty: "Сложно",
    strategyHint: "Железный двор уже запущен, но соперник сильнее, чем в долине. Сначала накопите оружие, затем отправьте катапульты к башням и стенам; разрушенные укрепления считаются даже после их восстановления.",
    theme: "ancient-ruins", goalKind: "duel", goalTarget: 13, goalLabel: "Разрушить 5 укреплений и сохранить 8 оружия",
    gridSize: 28,
    startingResources: { wood: 220, stone: 195, food: 135, gold: 155, grain: 8, iron: 14, weapons: 0 }, startingPopulation: 10, startingPopulationCap: 15, startingHope: 76,
    keep: { gx: 5, gz: 9 }, resourceZones: { lumber: { gx: 3, gz: 4 }, quarry: { gx: 10, gz: 17 }, iron: { gx: 5, gz: 13 }, fertile: { gx: 10, gz: 6 } },
    startingBuildings: [
      { kind: "house", gx: 10, gz: 10 }, { kind: "farm", gx: 10, gz: 7 }, { kind: "ironMine", gx: 6, gz: 13 },
    ],
    waves: [],
    events: [
      { id: "ruins-cache", at: 60, title: "Оружейный тайник", description: "Под старой аркой нашли железо и четыре готовых клинка.", tone: "success", resources: { weapons: 4, iron: 22 }, hope: 4 },
      { id: "ruins-restoration", at: 145, title: "Эмир укрепляет сады", description: "На противоположной стороне восстановлены башни. Осадный двор поможет разбирать их с расстояния.", tone: "danger" },
      { id: "ruins-masons", at: 265, title: "Мастера старого города", description: "Союзные мастера доставили материалы для осадных машин.", tone: "success", resources: { stone: 48, wood: 62, gold: 35 } },
    ],
    duel: {
      enemyName: "Дворец эмира Сафара",
      objective: { kind: "break-fortress", primaryTarget: 5, supportTarget: 8 },
      aiPace: 0.93,
      enemyKeep: { gx: 22, gz: 19 },
      enemyResourceZones: { lumber: { gx: 25, gz: 24 }, quarry: { gx: 25, gz: 8 }, iron: { gx: 18, gz: 25 }, fertile: { gx: 19, gz: 16 } },
      neutralZone: { minGx: 12, maxGx: 15, minGz: 0, maxGz: 27 },
      playerBuildArea: { minGx: 0, maxGx: 11, minGz: 0, maxGz: 27 },
      enemyBuildArea: { minGx: 16, maxGx: 27, minGz: 0, maxGz: 27 },
      enemyStartingResources: { wood: 235, stone: 230, food: 155, gold: 170, grain: 12, iron: 18, weapons: 4 },
      enemyStartingPopulation: 12,
      enemyStartingPopulationCap: 20,
      enemyStartingBuildings: [
        { kind: "house", gx: 21, gz: 21 }, { kind: "house", gx: 23, gz: 21 }, { kind: "farm", gx: 19, gz: 16 },
        { kind: "quarry", gx: 24, gz: 8 }, { kind: "ironMine", gx: 19, gz: 25 }, { kind: "blacksmith", gx: 20, gz: 18 },
        { kind: "barracks", gx: 19, gz: 19 }, { kind: "archery", gx: 20, gz: 20 },
        { kind: "tower", gx: 17, gz: 17, towerUpgrade: "light" }, { kind: "wall", gx: 17, gz: 18 },
        { kind: "gate", gx: 17, gz: 19 }, { kind: "wall", gx: 17, gz: 20 }, { kind: "tower", gx: 17, gz: 21 },
      ],
    },
  },
  siege: {
    id: "siege", order: 6, name: "Два замка", subtitle: "Финальное противостояние",
    briefing: "Финал караванного пути. Крепость аль-Мазин богата, вооружена и развивается быстрее прежних соперников. Переживите её походы, пробейте внешнюю стену и разрушьте цитадель.", difficulty: "Сложно",
    strategyHint: "У каждого замка свои рощи, камень, железо и плодородная земля. В центральной полосе строить нельзя. Поднимите лучников на башни или выберите защитный модуль, затем соберите катапульты и таран в осадном дворе.",
    theme: "siege-frontier", goalKind: "duel", goalTarget: 100, goalLabel: "Разрушить цитадель соперника",
    gridSize: 30,
    startingResources: { wood: 250, stone: 245, food: 160, gold: 195, grain: 24, iron: 24, weapons: 6 }, startingPopulation: 13, startingPopulationCap: 21, startingHope: 80,
    keep: { gx: 5, gz: 15 }, resourceZones: { lumber: { gx: 2, gz: 23 }, quarry: { gx: 2, gz: 7 }, iron: { gx: 8, gz: 25 }, fertile: { gx: 7, gz: 12 } },
    startingBuildings: [
      { kind: "house", gx: 4, gz: 17 }, { kind: "house", gx: 6, gz: 17 }, { kind: "farm", gx: 7, gz: 12 },
      { kind: "quarry", gx: 3, gz: 7 }, { kind: "barracks", gx: 7, gz: 16 }, { kind: "tower", gx: 9, gz: 13 },
      { kind: "wall", gx: 9, gz: 14 }, { kind: "gate", gx: 9, gz: 15 }, { kind: "wall", gx: 9, gz: 16 },
    ],
    waves: [],
    events: [
      { id: "duel-rival-grows", at: 70, title: "Соперник расширяется", description: "На дальнем берегу появились новые мастерские. Он добывает ресурсы и развивается одновременно с вами.", tone: "info" },
      { id: "duel-siege-warning", at: 155, title: "Замечены осадные машины", description: "Тяжёлый модуль на башне выбирает катапульты и тараны главной целью.", tone: "danger" },
      { id: "duel-watchfires", at: 270, title: "Огни над долиной", description: "Оба замка вошли в решающую стадию. Исход определят только накопленные запасы, построенная защита и выбранный план.", tone: "danger" },
    ],
    duel: {
      enemyName: "Замок аль-Мазин",
      objective: { kind: "destroy-keep", primaryTarget: 100 },
      aiPace: 1.18,
      enemyKeep: { gx: 24, gz: 15 },
      enemyResourceZones: { lumber: { gx: 27, gz: 23 }, quarry: { gx: 27, gz: 7 }, iron: { gx: 21, gz: 25 }, fertile: { gx: 22, gz: 12 } },
      neutralZone: { minGx: 11, maxGx: 18, minGz: 0, maxGz: 29 },
      playerBuildArea: { minGx: 0, maxGx: 10, minGz: 0, maxGz: 29 },
      enemyBuildArea: { minGx: 19, maxGx: 29, minGz: 0, maxGz: 29 },
      enemyStartingResources: { wood: 260, stone: 255, food: 175, gold: 210, grain: 24, iron: 28, weapons: 7 },
      enemyStartingPopulation: 14,
      enemyStartingPopulationCap: 22,
      enemyStartingBuildings: [
        { kind: "house", gx: 23, gz: 17 }, { kind: "house", gx: 25, gz: 17 }, { kind: "farm", gx: 22, gz: 12 },
        { kind: "quarry", gx: 26, gz: 7 }, { kind: "barracks", gx: 22, gz: 16 }, { kind: "archery", gx: 22, gz: 14 },
        { kind: "siegeWorkshop", gx: 25, gz: 19 }, { kind: "tower", gx: 20, gz: 13, towerUpgrade: "heavy" },
        { kind: "wall", gx: 20, gz: 14 }, { kind: "gate", gx: 20, gz: 15 }, { kind: "wall", gx: 20, gz: 16 },
        { kind: "tower", gx: 20, gz: 17, towerUpgrade: "light" },
      ],
    },
  },
};

export const MISSION_LIST = Object.values(MISSIONS).sort((a, b) => a.order - b.order);
