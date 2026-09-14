import {
  CHIRIKOV_CONTOUR_ITER,
  CHIRIKOV_HALF_TURN,
  CHIRIKOV_TAU,
} from './constants';

export type ChirikovSignature = {
  theta: number;
  momentum: number;
  phase: number;
  coherence: number;
  contourPhase: number;
};

export function wrapChirikovAngle(value: number): number {
  return value - CHIRIKOV_TAU * Math.floor((value + CHIRIKOV_HALF_TURN) / CHIRIKOV_TAU);
}

/**
 * Iterate the standard area-preserving map on the two-torus.
 *
 * The circular mean of momentum supplies a stable phase color. Its resultant
 * length measures how coherently the orbit follows one rotational layer.
 */
export function chirikovSignature(
  theta0: number,
  momentum0: number,
  k: number,
  iterations: number,
): ChirikovSignature {
  let theta = wrapChirikovAngle(theta0);
  let momentum = wrapChirikovAngle(momentum0);
  let meanCos = 0;
  let meanSin = 0;
  let contourTheta = theta;
  const steps = Math.max(1, Math.round(iterations));
  const contourStep = Math.min(CHIRIKOV_CONTOUR_ITER, steps);

  for (let i = 0; i < steps; i++) {
    const kick = Math.sin(theta);
    momentum = wrapChirikovAngle(momentum + k * kick);
    theta = wrapChirikovAngle(theta + momentum);
    if (i + 1 === contourStep) contourTheta = theta;
    meanCos += Math.cos(momentum);
    meanSin += Math.sin(momentum);
  }

  meanCos /= steps;
  meanSin /= steps;
  const phase = Math.atan2(meanSin, meanCos) / CHIRIKOV_TAU + 0.5;
  const contourPhase = contourTheta / CHIRIKOV_TAU + 0.5;
  return {
    theta,
    momentum,
    phase: phase - Math.floor(phase),
    coherence: Math.min(1, Math.hypot(meanCos, meanSin)),
    contourPhase: contourPhase - Math.floor(contourPhase),
  };
}

export function packChirikovSignature(signature: ChirikovSignature): number {
  const phase = Math.max(0, Math.min(1023, Math.round(signature.phase * 1023)));
  const coherence = Math.max(0, Math.min(1023, Math.round(signature.coherence * 1023)));
  const contourPhase = Math.max(0, Math.min(1023, Math.round(signature.contourPhase * 1023)));
  return phase | (coherence << 10) | (contourPhase << 20);
}
