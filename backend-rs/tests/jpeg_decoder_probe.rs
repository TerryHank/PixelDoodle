use std::{env, fs, path::{Path, PathBuf}, process::Command};

use crc32fast::hash as crc32_hash;
use image::ImageReader;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("backend-rs should live under repo root")
        .to_path_buf()
}

fn python_executable() -> String {
    env::var("PYTHON_EXECUTABLE")
        .unwrap_or_else(|_| "D:\\Workspace\\PixelDoodle-web\\.venv\\Scripts\\python.exe".to_string())
}

fn python_rgb_crc(image_path: &Path) -> u32 {
    let script = r#"
from PIL import Image
import numpy as np, zlib, sys
img = Image.open(sys.argv[1]).convert('RGB')
print(zlib.crc32(np.array(img, dtype=np.uint8).tobytes()) & 0xffffffff)
"#;
    let output = Command::new(python_executable())
        .arg("-c")
        .arg(script)
        .arg(image_path)
        .current_dir(repo_root())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "python probe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().parse::<u32>().unwrap()
}

#[test]
fn compare_jpeg_decoders_against_pillow() {
    let image_path = repo_root().join("docs").join("examples").join("luoxiaohei_original.jpg");
    let bytes = fs::read(&image_path).unwrap();
    let pillow_crc = python_rgb_crc(&image_path);

    let image_rs = ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .unwrap()
        .decode()
        .unwrap()
        .to_rgb8();
    let image_rs_crc = crc32_hash(image_rs.as_raw());

    let mut moz = mozjpeg::Decompress::with_markers(mozjpeg::NO_MARKERS)
        .from_mem(&bytes)
        .unwrap()
        .rgb()
        .unwrap();
    let moz_pixels: Vec<[u8; 3]> = moz.read_scanlines().unwrap();
    let moz_bytes = moz_pixels
        .iter()
        .flat_map(|pixel| pixel.iter().copied())
        .collect::<Vec<_>>();
    let moz_crc = crc32_hash(&moz_bytes);

    println!("pillow_crc={pillow_crc} image_rs_crc={image_rs_crc} moz_crc={moz_crc}");
}
