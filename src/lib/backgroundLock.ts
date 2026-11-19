/** Web Locks serialize background work between same-origin tabs when available.
 * The visibility/storage warning in App remains the fallback on LAN HTTP browsers.
 * This is not a transaction for localStorage writes across browser tabs.
 */
export async function withBackgroundTickLock(
  work: () => Promise<void>,
  manager: Pick<LockManager, 'request'> | undefined =
    typeof navigator === 'undefined' ? undefined : navigator.locks,
): Promise<boolean> {
  if (!manager?.request) {
    await work();
    return true;
  }
  let ran = false;
  await manager.request('startnow.background-tick', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) return;
    ran = true;
    await work();
  });
  return ran;
}
