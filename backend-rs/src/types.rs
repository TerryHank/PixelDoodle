use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GridSize {
    pub width: usize,
    pub height: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColorSummaryEntry {
    pub code: String,
    pub name: String,
    pub name_zh: String,
    pub hex: String,
    pub rgb: [u8; 3],
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EngineOutput {
    pub grid_size: GridSize,
    pub pixel_matrix: Vec<Vec<Option<String>>>,
    pub color_summary: Vec<ColorSummaryEntry>,
    pub total_beads: usize,
    pub preview_image: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GenerateOptions {
    pub mode: String,
    pub grid_width: usize,
    pub grid_height: usize,
    pub led_size: usize,
    pub pixel_size: usize,
    pub use_dithering: bool,
    pub palette_preset: String,
    pub max_colors: usize,
    pub similarity_threshold: usize,
    pub remove_bg: bool,
    pub contrast: f32,
    pub saturation: f32,
    pub sharpness: f32,
}

impl Default for GenerateOptions {
    fn default() -> Self {
        Self {
            mode: "fixed_grid".to_string(),
            grid_width: 48,
            grid_height: 48,
            led_size: 64,
            pixel_size: 8,
            use_dithering: false,
            palette_preset: "221".to_string(),
            max_colors: 0,
            similarity_threshold: 0,
            remove_bg: false,
            contrast: 0.0,
            saturation: 0.0,
            sharpness: 0.0,
        }
    }
}
