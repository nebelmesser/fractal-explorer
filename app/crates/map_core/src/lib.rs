//! Single-trajectory double pendulum. Same ODE as the GPU map kernel, used
//! only to pose and animate the preview — the map is never computed here.

mod constants;

use wasm_bindgen::prelude::*;

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
        let (alpha1, alpha2) = accelerations(self.th1, self.th2, self.w1, self.w2, l1, l2, m1, m2, g);
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

fn accelerations(
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
