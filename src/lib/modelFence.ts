/** A browser model request must hold a live storage-generation permit.
 * Registered by store at module initialization, avoiding a store/LLM cycle.
 * Pure domain/Node tests with no browser storage remain usable. */
let provider: (() => () => boolean) | undefined;
export const registerModelFence = (capture: () => () => boolean): void => { provider = capture; };
export function captureModelFence(): () => boolean {
  // A genuinely storage-free Node runtime is not a product browser.
  if (typeof window === 'undefined' && typeof globalThis.localStorage === 'undefined') return () => true;
  // Browser code must have initialized the store. Missing registration fails closed.
  if (!provider) return () => typeof window === 'undefined';
  return provider();
}
