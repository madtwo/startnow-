/** Bounded output budgets for short tasks on reasoning-enabled models.
 * max_tokens can include invisible reasoning tokens; these limits are ceilings,
 * not requested visible-text lengths. Re-evaluate against paid API traces.
 * See: 2026-11-18 conversation-quality receipt E5; 2026-11-19 raised each
 * conversation ceiling by ~50% as a quality/cost experiment.
 */
export const SHORT_TASK_TOKEN_BUDGETS = Object.freeze({
  advice: 900, // select a curated action ID (was 600; 2026-11-19 +50% trial)
  shrink: 450, // one smaller action (was 300; 2026-11-19 +50% trial)
  brag: 600,   // one fictional follow-up card (was 400; 2026-11-19 +50% trial)
});
