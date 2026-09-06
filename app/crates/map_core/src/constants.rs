//! Physics defaults shared with `app/src/constants.ts`.
//! The map itself never runs here — only one pendulum trajectory for the preview.

#![allow(dead_code)] // kept as the TS/WGSL numeric contract

pub const L1: f32 = 1.0;
pub const L2: f32 = 1.0;
pub const M1: f32 = 1.0;
pub const M2: f32 = 1.0;
pub const G: f32 = 9.81;
pub const F: f32 = 0.0;
pub const SINGULAR: f32 = 1.0e-9;
