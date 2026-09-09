/** Pendulum canvas colors come exclusively from CSS custom properties. */
function cssVar(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) throw new Error(`Missing pendulum color ${name}`);
  return value;
}

export type Theme = {
  th1: string;
  th2: string;
  pivot: string;
  previewAxis: string;
  pieTrack: string;
  pieZero: string;
  zoomFrame: string;
  axisShadow: string;
  axisOutline: string;
  figureOutline: string;
  reticleOutline: string;
  reticleCore: string;
  pivotOutline: string;
  lessonRing1: string;
  lessonRing2: string;
  lessonNeighbor: string;
};

let cachedTheme: Theme | null = null;

export function theme(): Theme {
  if (cachedTheme) return cachedTheme;
  cachedTheme = {
    th1: cssVar('--th1'),
    th2: cssVar('--th2'),
    pivot: cssVar('--pivot'),
    previewAxis: cssVar('--preview-axis'),
    pieTrack: cssVar('--pie-track'),
    pieZero: cssVar('--pie-zero'),
    zoomFrame: cssVar('--zoom-frame'),
    axisShadow: cssVar('--shadow'),
    axisOutline: cssVar('--axis-outline'),
    figureOutline: cssVar('--figure-outline'),
    reticleOutline: cssVar('--reticle-outline'),
    reticleCore: cssVar('--reticle-core'),
    pivotOutline: cssVar('--pivot-outline'),
    lessonRing1: cssVar('--lesson-ring-1'),
    lessonRing2: cssVar('--lesson-ring-2'),
    lessonNeighbor: cssVar('--lesson-neighbor'),
  };
  return cachedTheme;
}
