/**
 * A speed budget in ms. Shared CI machines (slow disks, noisy neighbours) get
 * three times as long, so a slow runner can't fail the build; a real slowdown
 * still shows up locally and as a big miss on CI.
 */
export const budget = (ms: number) => ms * (process.env.CI ? 3 : 1);
