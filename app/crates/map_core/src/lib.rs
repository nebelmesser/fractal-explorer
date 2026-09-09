//! Double-pendulum ODE shared with the GPU map kernel.
//!
//! `Pendulum` steps one f32 trajectory so the overlay matches GPU tiles.
//! `PendulumF64` is the same integrator in f64 for deep views where f32
//! samples collapse. `fill_map_tile` fills a pixel strip in f64.

mod constants;

use wasm_bindgen::prelude::*;

const TWO_PI: f64 = std::f64::consts::TAU;
const FOUR_PI: f64 = TWO_PI * 2.0;
const SINGULAR_F64: f64 = 1.0e-9;

/// One pendulum in (θ₁, θ₂, ω₁, ω₂). Angles are radians from downward vertical.
#[wasm_bindgen]
pub struct Pendulum {
    th1: f32,
    th2: f32,
    w1: f32,
    w2: f32,
}

#[wasm_bindgen]
impl Pendulum {
    #[wasm_bindgen(constructor)]
    pub fn new(th1: f32, th2: f32) -> Pendulum {
        Pendulum {
            th1,
            th2,
            w1: 0.0,
            w2: 0.0,
        }
    }

    /// Semi-implicit Euler step. Formulas match the WGSL compute kernel.
    pub fn step(&mut self, l1: f32, l2: f32, m1: f32, m2: f32, g: f32, f: f32, dt: f32) {
        let (alpha1, alpha2) = accelerations_f32(self.th1, self.th2, self.w1, self.w2, l1, l2, m1, m2, g);
        self.w1 += (alpha1 - f * self.w1) * dt;
        self.w2 += (alpha2 - f * self.w2) * dt;
        self.th1 += self.w1 * dt;
        self.th2 += self.w2 * dt;
    }

    #[wasm_bindgen(getter)]
    pub fn th1(&self) -> f32 {
        self.th1
    }

    #[wasm_bindgen(getter)]
    pub fn th2(&self) -> f32 {
        self.th2
    }

    #[wasm_bindgen(getter)]
    pub fn w1(&self) -> f32 {
        self.w1
    }

    #[wasm_bindgen(getter)]
    pub fn w2(&self) -> f32 {
        self.w2
    }
}

/// Overlay trajectory in f64. Used automatically past the f32 zoom floor.
#[wasm_bindgen]
pub struct PendulumF64 {
    th1: f64,
    th2: f64,
    w1: f64,
    w2: f64,
}

#[wasm_bindgen]
impl PendulumF64 {
    #[wasm_bindgen(constructor)]
    pub fn new(th1: f64, th2: f64) -> PendulumF64 {
        PendulumF64 {
            th1,
            th2,
            w1: 0.0,
            w2: 0.0,
        }
    }

    pub fn step(&mut self, l1: f64, l2: f64, m1: f64, m2: f64, g: f64, f: f64, dt: f64) {
        let phys = PhysF64 {
            l1,
            l2,
            m1,
            m2,
            g,
            dt,
            f,
            g_m1_plus_m2: g * (m1 + m2),
            two_m1_plus_m2: 2.0 * m1 + m2,
        };
        let (alpha1, alpha2) = accelerations_f64(self.th1, self.th2, self.w1, self.w2, &phys);
        self.w1 += (alpha1 - f * self.w1) * dt;
        self.w2 += (alpha2 - f * self.w2) * dt;
        self.th1 += self.w1 * dt;
        self.th2 += self.w2 * dt;
    }

    #[wasm_bindgen(getter)]
    pub fn th1(&self) -> f64 {
        self.th1
    }

    #[wasm_bindgen(getter)]
    pub fn th2(&self) -> f64 {
        self.th2
    }

    #[wasm_bindgen(getter)]
    pub fn w1(&self) -> f64 {
        self.w1
    }

    #[wasm_bindgen(getter)]
    pub fn w2(&self) -> f64 {
        self.w2
    }
}

/// Fill `out` with escape-time samples for rows `[row0, row1)` of a `width×height`
/// tile. `out` is `width * (row1 - row0)` tightly packed rows.
#[wasm_bindgen]
pub fn fill_map_tile(
    out: &mut [f32],
    width: u32,
    height: u32,
    row0: u32,
    row1: u32,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    l1: f64,
    l2: f64,
    m1: f64,
    m2: f64,
    g: f64,
    dt: f64,
    f: f64,
    max_iter: u32,
) {
    let width = width.max(1) as usize;
    let height = height.max(1) as usize;
    let y0 = (row0 as usize).min(height);
    let y1 = (row1 as usize).min(height).max(y0);
    let rows = y1 - y0;
    if out.len() < width * rows {
        return;
    }
    let x_den = width as f64;
    let y_den = height as f64;
    let span_x = x_max - x_min;
    let span_y = y_max - y_min;
    let phys = PhysF64 {
        l1,
        l2,
        m1,
        m2,
        g,
        dt,
        f,
        g_m1_plus_m2: g * (m1 + m2),
        two_m1_plus_m2: 2.0 * m1 + m2,
    };
    for (local_y, y) in (y0..y1).enumerate() {
        let th2_row = wrap_th2(y_min + span_y * (y as f64 + 0.5) / y_den);
        let row = local_y * width;
        let mut x = 0;
        while x + 3 < width {
            let th1 = [
                x_min + span_x * (x as f64 + 0.5) / x_den,
                x_min + span_x * (x as f64 + 1.5) / x_den,
                x_min + span_x * (x as f64 + 2.5) / x_den,
                x_min + span_x * (x as f64 + 3.5) / x_den,
            ];
            let cycles = integrate_lanes(th1, th2_row, &phys, max_iter);
            out[row + x] = cycles[0] as f32;
            out[row + x + 1] = cycles[1] as f32;
            out[row + x + 2] = cycles[2] as f32;
            out[row + x + 3] = cycles[3] as f32;
            x += 4;
        }
        while x < width {
            let th1 = x_min + span_x * (x as f64 + 0.5) / x_den;
            out[row + x] = integrate_one(th1, th2_row, &phys, max_iter) as f32;
            x += 1;
        }
    }
}

fn wrap_th2(th: f64) -> f64 {
    th - FOUR_PI * (th / FOUR_PI).round()
}

struct PhysF64 {
    l1: f64,
    l2: f64,
    m1: f64,
    m2: f64,
    g: f64,
    dt: f64,
    f: f64,
    g_m1_plus_m2: f64,
    two_m1_plus_m2: f64,
}

fn integrate_one(start_th1: f64, start_th2: f64, phys: &PhysF64, max_iter: u32) -> u32 {
    let mut th1 = start_th1;
    let mut th2 = start_th2;
    let mut w1 = 0.0;
    let mut w2 = 0.0;
    let mut cycles = 0u32;
    let dt = phys.dt;
    let f = phys.f;
    for _ in 0..max_iter {
        let (alpha1, alpha2) = accelerations_f64(th1, th2, w1, w2, phys);
        w1 += (alpha1 - f * w1) * dt;
        w2 += (alpha2 - f * w2) * dt;
        th1 += w1 * dt;
        th2 += w2 * dt;
        cycles += 1;
        if th1.abs() > TWO_PI {
            break;
        }
    }
    cycles
}

fn integrate_lanes(
    start_th1: [f64; 4],
    start_th2: f64,
    phys: &PhysF64,
    max_iter: u32,
) -> [u32; 4] {
    let mut th1 = start_th1;
    let mut th2 = [start_th2; 4];
    let mut w1 = [0.0; 4];
    let mut w2 = [0.0; 4];
    let mut cycles = [0u32; 4];
    let mut live = [true; 4];
    let mut n_live = 4u32;
    let dt = phys.dt;
    let f = phys.f;
    for _ in 0..max_iter {
        if n_live == 0 {
            break;
        }
        // Unrolled so four independent trig chains stay in flight.
        step_lane(0, &mut th1, &mut th2, &mut w1, &mut w2, &mut cycles, &mut live, &mut n_live, phys, dt, f);
        step_lane(1, &mut th1, &mut th2, &mut w1, &mut w2, &mut cycles, &mut live, &mut n_live, phys, dt, f);
        step_lane(2, &mut th1, &mut th2, &mut w1, &mut w2, &mut cycles, &mut live, &mut n_live, phys, dt, f);
        step_lane(3, &mut th1, &mut th2, &mut w1, &mut w2, &mut cycles, &mut live, &mut n_live, phys, dt, f);
    }
    cycles
}

#[inline(always)]
fn step_lane(
    k: usize,
    th1: &mut [f64; 4],
    th2: &mut [f64; 4],
    w1: &mut [f64; 4],
    w2: &mut [f64; 4],
    cycles: &mut [u32; 4],
    live: &mut [bool; 4],
    n_live: &mut u32,
    phys: &PhysF64,
    dt: f64,
    f: f64,
) {
    if !live[k] {
        return;
    }
    let (alpha1, alpha2) = accelerations_f64(th1[k], th2[k], w1[k], w2[k], phys);
    w1[k] += (alpha1 - f * w1[k]) * dt;
    w2[k] += (alpha2 - f * w2[k]) * dt;
    th1[k] += w1[k] * dt;
    th2[k] += w2[k] * dt;
    cycles[k] += 1;
    if th1[k].abs() > TWO_PI {
        live[k] = false;
        *n_live -= 1;
    }
}

fn accelerations_f32(
    th1: f32,
    th2: f32,
    w1: f32,
    w2: f32,
    l1: f32,
    l2: f32,
    m1: f32,
    m2: f32,
    g: f32,
) -> (f32, f32) {
    let g_m1_plus_m2 = g * (m1 + m2);
    let two_m1_plus_m2 = 2.0 * m1 + m2;
    let sin_th1 = th1.sin();
    let cos_th1 = th1.cos();
    let sin_th1_minus_th2 = (th1 - th2).sin();
    let cos_th1_minus_th2 = (th1 - th2).cos();
    let cos_2th1_minus_2th2 = (2.0 * (th1 - th2)).cos();
    let common = two_m1_plus_m2 - m2 * cos_2th1_minus_2th2;

    let den1 = l1 * common;
    let alpha1 = if den1.abs() < constants::SINGULAR {
        0.0
    } else {
        let num1_1 = -g * two_m1_plus_m2 * sin_th1;
        let sin_th1_minus_2th2 = (th1 - 2.0 * th2).sin();
        let num1_3_and_4 =
            -2.0 * sin_th1_minus_th2 * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * cos_th1_minus_th2);
        (num1_1 + (-m2 * g * sin_th1_minus_2th2) + num1_3_and_4) / den1
    };

    let den2 = l2 * common;
    let alpha2 = if den2.abs() < constants::SINGULAR {
        0.0
    } else {
        let term_sum =
            w1 * w1 * l1 * (m1 + m2) + g_m1_plus_m2 * cos_th1 + w2 * w2 * l2 * m2 * cos_th1_minus_th2;
        (2.0 * sin_th1_minus_th2 * term_sum) / den2
    };

    (alpha1, alpha2)
}

#[inline(always)]
fn sincos_f64(x: f64) -> (f64, f64) {
    let y = x - TWO_PI * (x / TWO_PI).round();
    let y2 = y * y;
    let sin = y * (1.0
        + y2 * (-1.666666666666667e-1
            + y2 * (8.333333333333333e-3
                + y2 * (-1.9841269841269841e-4
                    + y2 * (2.7557319223985893e-6
                        + y2 * (-2.505210838544172e-8 + y2 * 1.6059043836821613e-10))))));
    let cos = 1.0
        + y2 * (-0.5
            + y2 * (4.1666666666666664e-2
                + y2 * (-1.388888888888889e-3
                    + y2 * (2.48015873015873e-5
                        + y2 * (-2.755731922398589e-7 + y2 * 2.08767569878681e-9)))));
    (sin, cos)
}

#[inline(always)]
fn accelerations_f64(th1: f64, th2: f64, w1: f64, w2: f64, phys: &PhysF64) -> (f64, f64) {
    let (sin_th1, cos_th1) = sincos_f64(th1);
    let (sin_th2, cos_th2) = sincos_f64(th2);
    let sin_th1_minus_th2 = sin_th1 * cos_th2 - cos_th1 * sin_th2;
    let cos_th1_minus_th2 = cos_th1 * cos_th2 + sin_th1 * sin_th2;
    let cos_2th1_minus_2th2 = 2.0 * cos_th1_minus_th2 * cos_th1_minus_th2 - 1.0;
    let common = phys.two_m1_plus_m2 - phys.m2 * cos_2th1_minus_2th2;

    let den1 = phys.l1 * common;
    let alpha1 = if den1.abs() < SINGULAR_F64 {
        0.0
    } else {
        let num1_1 = -phys.g * phys.two_m1_plus_m2 * sin_th1;
        let sin_th1_minus_2th2 = sin_th1_minus_th2 * cos_th2 - cos_th1_minus_th2 * sin_th2;
        let num1_3_and_4 = -2.0
            * sin_th1_minus_th2
            * phys.m2
            * (w2 * w2 * phys.l2 + w1 * w1 * phys.l1 * cos_th1_minus_th2);
        (num1_1 + (-phys.m2 * phys.g * sin_th1_minus_2th2) + num1_3_and_4) / den1
    };

    let den2 = phys.l2 * common;
    let alpha2 = if den2.abs() < SINGULAR_F64 {
        0.0
    } else {
        let term_sum = w1 * w1 * phys.l1 * (phys.m1 + phys.m2)
            + phys.g_m1_plus_m2 * cos_th1
            + w2 * w2 * phys.l2 * phys.m2 * cos_th1_minus_th2;
        (2.0 * sin_th1_minus_th2 * term_sum) / den2
    };

    (alpha1, alpha2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn poly_sincos_matches_libm_cycles() {
        let phys = lake_phys();
        let mut worst = 0u32;
        for i in 0..40 {
            let th1 = -1.2 + f64::from(i) * 0.07;
            let th2 = 0.4 - f64::from(i) * 0.05;
            let fast = integrate_one(th1, th2, &phys, 800);
            let slow = integrate_libm(th1, th2, &phys, 800);
            worst = worst.max(fast.abs_diff(slow));
        }
        assert!(worst <= 2, "cycle drift {worst}");
    }

    fn integrate_libm(start_th1: f64, start_th2: f64, phys: &PhysF64, max_iter: u32) -> u32 {
        let mut th1 = start_th1;
        let mut th2 = start_th2;
        let mut w1 = 0.0;
        let mut w2 = 0.0;
        let mut cycles = 0u32;
        for _ in 0..max_iter {
            let (sin_th1, cos_th1) = th1.sin_cos();
            let (sin_th2, cos_th2) = th2.sin_cos();
            let sin_d = sin_th1 * cos_th2 - cos_th1 * sin_th2;
            let cos_d = cos_th1 * cos_th2 + sin_th1 * sin_th2;
            let cos_2d = 2.0 * cos_d * cos_d - 1.0;
            let common = phys.two_m1_plus_m2 - phys.m2 * cos_2d;
            let den1 = phys.l1 * common;
            let alpha1 = if den1.abs() < SINGULAR_F64 {
                0.0
            } else {
                let sin_th1_minus_2th2 = sin_d * cos_th2 - cos_d * sin_th2;
                let num = -phys.g * phys.two_m1_plus_m2 * sin_th1
                    + (-phys.m2 * phys.g * sin_th1_minus_2th2)
                    + -2.0 * sin_d * phys.m2 * (w2 * w2 * phys.l2 + w1 * w1 * phys.l1 * cos_d);
                num / den1
            };
            let den2 = phys.l2 * common;
            let alpha2 = if den2.abs() < SINGULAR_F64 {
                0.0
            } else {
                let term_sum = w1 * w1 * phys.l1 * (phys.m1 + phys.m2)
                    + phys.g_m1_plus_m2 * cos_th1
                    + w2 * w2 * phys.l2 * phys.m2 * cos_d;
                (2.0 * sin_d * term_sum) / den2
            };
            w1 += (alpha1 - phys.f * w1) * phys.dt;
            w2 += (alpha2 - phys.f * w2) * phys.dt;
            th1 += w1 * phys.dt;
            th2 += w2 * phys.dt;
            cycles += 1;
            if th1.abs() > TWO_PI {
                break;
            }
        }
        cycles
    }

    fn lake_phys() -> PhysF64 {
        PhysF64 {
            l1: 1.0,
            l2: 1.0,
            m1: 1.0,
            m2: 1.0,
            g: 9.81,
            dt: 0.2,
            f: 0.0,
            g_m1_plus_m2: 9.81 * 2.0,
            two_m1_plus_m2: 3.0,
        }
    }
}
