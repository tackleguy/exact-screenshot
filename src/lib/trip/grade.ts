/**
 * Steepest sustained grade from an elevation profile, robust to DEM noise: elevations are smoothed with a 5-sample
 * moving average, then the grade is measured over a 100 m window. Used by the data build and the trail page alike.
 */
export const GRADE_WINDOW_M = 100;
export const GRADE_DISPLAY_CAP = 60;

/** Centered 5-sample moving average (shorter at the ends); non-finite samples are skipped. */
export function smooth5(values: number[]): number[] {
  return values.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(values.length - 1, i + 2); j++) if (Number.isFinite(values[j])) { sum += values[j]; n++; }
    return n ? sum / n : NaN;
  });
}

/**
 * Largest absolute grade (percent) over any 100 m stretch. `along` and `elevations` are in meters and the same length;
 * returns null when the profile is shorter than one window.
 */
export function steepestGrade(along: number[], elevations: number[]): number | null {
  const e = smooth5(elevations);
  let best: number | null = null;
  let j = 0;
  for (let i = 0; i < along.length; i++) {
    if (!Number.isFinite(e[i])) continue;
    if (j < i) j = i;
    while (j < along.length && along[j] - along[i] < GRADE_WINDOW_M) j++;
    if (j >= along.length) break;
    if (!Number.isFinite(e[j])) continue;
    const grade = (Math.abs(e[j] - e[i]) / (along[j] - along[i])) * 100;
    if (best === null || grade > best) best = grade;
  }
  return best === null ? null : Math.round(best * 10) / 10;
}
