// Run with playwright-cli run-code --filename tools/render-building-portraits.playwright.js
// Open tools/building-portrait.html on the local Vite server first.
async (page) => {
  await page.waitForFunction(() => window.portraitReady);
  await page.setViewportSize({ width: 720, height: 600 });
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    canvas.style.width = '640px'; canvas.style.height = '512px';
  });
  const kinds = ['keep','house','lumber','quarry','farm','wheatFarm','mill','bakery','ironMine','blacksmith','well','granary','market','tower','wall','gate','barracks','archery','stable','siegeWorkshop'];
  const results = [];
  for (const kind of kinds) {
    results.push(await page.evaluate(kind => window.renderPortrait(kind), kind));
    const file = kind === 'siegeWorkshop' ? 'siegeWorkshop-model' : kind;
    await page.locator('canvas').screenshot({ path: `public/assets/ui/buildings/${file}.png`, omitBackground: true });
  }
  return results;
}
