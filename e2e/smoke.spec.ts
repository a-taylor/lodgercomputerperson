import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** A brand-new game at 2pm, fast enough that moving in takes seconds. */
const NEW_GAME = '/?seed=42&hour=14&quick&speed=600';

/** Fails on any serious or critical axe finding. */
async function expectAccessible(page: Page, label: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), label).toEqual([]);
}

test('move in, say hello, ask for the piano, and come back to the same tenant', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only: the phone test covers the small screen');
  // Moving in runs in real time (about two and a half minutes), whatever the speed.
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(NEW_GAME);
  await expect(page.locator('#status')).toContainText('The house is empty');
  await expectAccessible(page, 'empty house');

  // He moves in, knocks to say hello, and asks who you are.
  const intro = page.locator('#intro');
  await expect(intro).toBeVisible({ timeout: 200_000 });
  const tenant = (await page.locator('#tenant-name').getAttribute('placeholder'))!;
  await page.locator('#player-name').fill('Sam');
  await page.getByRole('button', { name: 'Say hello' }).click();
  await expect(intro).toBeHidden();

  // Ask for the piano: he answers one way or another, in words.
  await page.locator('#talk-input').fill('please play the piano');
  await page.getByRole('button', { name: 'Say', exact: true }).click();
  await expect(page.locator('#speech-log')).toContainText(`${tenant}:`);
  await expectAccessible(page, 'moved in');

  // The games and letters screens, which an audit of the first screen never sees.
  await page.getByRole('button', { name: /^Games/ }).click();
  await page.getByRole('button', { name: 'War' }).click();
  await expectAccessible(page, 'games');

  // Leave and come back: the save keeps him, and he doesn't ask your name again.
  await page.waitForTimeout(500);
  await page.evaluate(() => dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(500);
  await page.goto('/?speed=600');
  await expect(page.locator('#status')).toContainText(tenant);
  await expect(intro).toBeHidden();
  expect(errors).toEqual([]);
});

test('works on a phone: no sideways scrolling, tap him to pat him', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone only');
  await page.goto('/?seed=7&hour=14&movedIn&debug');
  await page.waitForFunction(() => 'lcp' in window);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // Tap where he's standing.
  await page.waitForFunction(() => {
    const { sim } = (window as unknown as { lcp: { sim: { person: { path: unknown[] } } } }).lcp;
    return sim.person.path.length === 0;
  });
  const spot = await page.evaluate(() => {
    const { sim } = (window as unknown as { lcp: { sim: { person: { x: number; y: number } } } }).lcp;
    const canvas = document.querySelector('canvas')!;
    const r = canvas.getBoundingClientRect();
    const k = r.width / canvas.width;
    return { x: r.left + sim.person.x * k, y: r.top + (sim.person.y - 10) * k };
  });
  await page.touchscreen.tap(spot.x, spot.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as { lcp: { sim: { pats: number[] } } }).lcp.sim.pats.length)).toBeGreaterThan(0);

  await page.screenshot({ path: 'test-results/phone.png', fullPage: true });
});
