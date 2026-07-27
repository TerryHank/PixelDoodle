use std::{collections::HashMap, fs, sync::OnceLock};

use serde::{Deserialize, Serialize};

use crate::{
    color::{rgb_to_lab, Lab},
    repo_root,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaletteColor {
    pub code: String,
    pub series: String,
    pub name: String,
    pub name_zh: String,
    pub hex: String,
    pub rgb: [u8; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PalettePreset {
    pub label: String,
    pub codes: Option<Vec<String>>,
}

#[derive(Debug)]
pub struct ArtkalPalette {
    pub colors: Vec<PaletteColor>,
    pub presets: HashMap<String, PalettePreset>,
    code_to_index: HashMap<String, usize>,
    lab_values: Vec<Lab>,
}

impl ArtkalPalette {
    pub fn load() -> Self {
        let root = repo_root();
        let colors: Vec<PaletteColor> = serde_json::from_str(
            &fs::read_to_string(root.join("data").join("artkal_m_series.json"))
                .expect("palette json should exist"),
        )
        .expect("palette json should parse");
        let presets: HashMap<String, PalettePreset> = serde_json::from_str(
            &fs::read_to_string(root.join("data").join("artkal_presets.json"))
                .expect("preset json should exist"),
        )
        .expect("preset json should parse");

        let mut code_to_index = HashMap::with_capacity(colors.len());
        let mut lab_values = Vec::with_capacity(colors.len());
        for (idx, color) in colors.iter().enumerate() {
            code_to_index.insert(color.code.clone(), idx);
            lab_values.push(rgb_to_lab(color.rgb));
        }

        Self {
            colors,
            presets,
            code_to_index,
            lab_values,
        }
    }

    pub fn get_preset_indices(&self, preset_key: &str) -> Option<Vec<usize>> {
        let preset = self.presets.get(preset_key)?;
        let codes = preset.codes.as_ref()?;
        let mut indices = Vec::with_capacity(codes.len());
        for code in codes {
            if let Some(index) = self.code_to_index.get(code) {
                indices.push(*index);
            }
        }
        if indices.is_empty() {
            None
        } else {
            indices.sort_unstable();
            Some(indices)
        }
    }

    pub fn get_color(&self, index: usize) -> Option<&PaletteColor> {
        self.colors.get(index)
    }

    pub fn get_by_code(&self, code: &str) -> Option<&PaletteColor> {
        self.code_to_index
            .get(code)
            .and_then(|index| self.colors.get(*index))
    }

    pub fn get_index_by_code(&self, code: &str) -> Option<usize> {
        self.code_to_index.get(code).copied()
    }

    pub fn lab(&self, index: usize) -> Lab {
        self.lab_values[index]
    }
}

static GLOBAL_PALETTE: OnceLock<ArtkalPalette> = OnceLock::new();

pub fn global_palette() -> &'static ArtkalPalette {
    GLOBAL_PALETTE.get_or_init(ArtkalPalette::load)
}
