pub type Lab = [f64; 3];

fn linearize(channel: f64) -> f64 {
    if channel > 0.04045 {
        ((channel + 0.055) / 1.055).powf(2.4)
    } else {
        channel / 12.92
    }
}

pub fn rgb_to_lab(rgb: [u8; 3]) -> Lab {
    let r_lin = linearize(f64::from(rgb[0]) / 255.0);
    let g_lin = linearize(f64::from(rgb[1]) / 255.0);
    let b_lin = linearize(f64::from(rgb[2]) / 255.0);

    let x = r_lin * 0.4124564 + g_lin * 0.3575761 + b_lin * 0.1804375;
    let y = r_lin * 0.2126729 + g_lin * 0.7151522 + b_lin * 0.0721750;
    let z = r_lin * 0.0193339 + g_lin * 0.1191920 + b_lin * 0.9503041;

    xyz_to_lab([x, y, z])
}

fn xyz_to_lab(xyz: [f64; 3]) -> Lab {
    let reference_white = [0.95047, 1.0, 1.08883];
    let delta = 6.0 / 29.0;
    let delta3 = delta * delta * delta;

    let f = |t: f64| {
        if t > delta3 {
            t.cbrt()
        } else {
            t / (3.0 * delta * delta) + 4.0 / 29.0
        }
    };

    let fx = f(xyz[0] / reference_white[0]);
    let fy = f(xyz[1] / reference_white[1]);
    let fz = f(xyz[2] / reference_white[2]);

    [
        116.0 * fy - 16.0,
        500.0 * (fx - fy),
        200.0 * (fy - fz),
    ]
}

pub fn lab_distance(lhs: Lab, rhs: Lab) -> f64 {
    let dl = lhs[0] - rhs[0];
    let da = lhs[1] - rhs[1];
    let db = lhs[2] - rhs[2];
    (dl * dl + da * da + db * db).sqrt()
}

pub fn grayscale_u8(rgb: [u8; 3]) -> u8 {
    let value =
        (u32::from(rgb[0]) * 299 + u32::from(rgb[1]) * 587 + u32::from(rgb[2]) * 114 + 500) / 1000;
    value.min(255) as u8
}

pub fn grayscale_f64(rgb: [f64; 3]) -> f64 {
    rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114
}
