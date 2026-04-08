mod color;
mod engine;
mod palette;
mod types;

use wasm_bindgen::prelude::*;

use crate::types::GenerateOptions;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn generate_pattern_bytes(bytes: &[u8], options: JsValue) -> Result<JsValue, JsValue> {
    let options: GenerateOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|err| JsValue::from_str(&format!("Invalid options: {err}")))?;
    let output = engine::process_image_bytes(bytes, options)
        .map_err(|err| JsValue::from_str(&format!("WASM processing failed: {err}")))?;
    serde_wasm_bindgen::to_value(&output)
        .map_err(|err| JsValue::from_str(&format!("Serialize output failed: {err}")))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn process_image_bytes_host(
    bytes: &[u8],
    options: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let options: GenerateOptions =
        serde_json::from_value(options).map_err(|err| format!("Invalid options: {err}"))?;
    let output =
        engine::process_image_bytes(bytes, options).map_err(|err| format!("Host processing failed: {err}"))?;
    serde_json::to_value(&output).map_err(|err| format!("Serialize output failed: {err}"))
}
