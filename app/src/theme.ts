/** Canvas colors come from `:root` in style.css. Tune them there. */
function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export type Theme = {
  th1: string;
  th2: string;
  pivot: string;
  previewAxis: string;
  zoomFrame: string;
  axisShadow: string;
};

export function theme(): Theme {
  return {
    th1: cssVar('--th1', '#ff2d2d'),
    th2: cssVar('--th2', '#2d7bff'),
    pivot: cssVar('--pivot', '#fff'),
    previewAxis: cssVar('--preview-axis', '#8a8a8a'),
    zoomFrame: cssVar('--zoom-frame', '#ffe600'),
    axisShadow: cssVar('--shadow', '#000'),
  };
}
