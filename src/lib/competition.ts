/** Competition is a presentation view, not a data migration or feature deletion. */
export function competitionModeEnabled(flag?: string, stored?: string | null): boolean {
  return flag === '1' || stored === '1';
}

const readCompetitionStorage = (): string | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem('startnow.competition'); }
  catch { return null; }
};

export const COMPETITION_MODE = competitionModeEnabled(
  (import.meta as ImportMeta & {env?:{VITE_COMPETITION?:string}}).env?.VITE_COMPETITION,
  readCompetitionStorage(),
);

export const competitionSummary = () => '今天动过了。';
