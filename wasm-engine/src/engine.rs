use std::collections::{BTreeMap, HashMap};

use crc32fast::hash as crc32_hash;
use image::{DynamicImage, ImageReader, Rgb, RgbImage};
use thiserror::Error;

use crate::{
    color::{grayscale_f64, grayscale_u8, lab_distance, rgb_to_lab},
    palette::{global_palette, ArtkalPalette},
    types::{ColorSummaryEntry, EngineOutput, GenerateOptions, GridSize},
};

const POOL_FACTOR: usize = 4;
const RESAMPLE_PRECISION_BITS: i32 = 32 - 8 - 2;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("failed to read image bytes: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to decode image: {0}")]
    Decode(#[from] image::ImageError),
}

pub fn process_image_bytes(
    bytes: &[u8],
    options: GenerateOptions,
) -> Result<EngineOutput, EngineError> {
    let rgb = decode_rgb_image(bytes)?;
    let palette = global_palette();
    process_rgb_image(rgb, palette, &options)
}

pub fn process_dynamic_image(
    image: DynamicImage,
    options: GenerateOptions,
) -> Result<EngineOutput, EngineError> {
    let palette = global_palette();
    let rgb = image.to_rgb8();
    process_rgb_image(rgb, palette, &options)
}

pub fn debug_subpalette_codes(
    bytes: &[u8],
    options: GenerateOptions,
) -> Result<Vec<String>, EngineError> {
    Ok(debug_pipeline(bytes, options)?.subpalette_codes)
}

#[derive(Debug, Clone)]
pub struct DebugPipelineOutput {
    pub subpalette_codes: Vec<String>,
    pub selection_ranked: Vec<(String, usize)>,
    pub original_crc32: u32,
    pub mean_gray: u8,
    pub p5: usize,
    pub p95: usize,
    pub contrast_factor: f32,
    pub contrast_crc32: u32,
    pub saturation_crc32: u32,
    pub sharpness_crc32: u32,
    pub preprocessed_crc32: u32,
    pub consolidated_crc32: u32,
    pub selection_crc32: u32,
    pub mid_crc32: u32,
    pub selection_image_pixels: Vec<[u8; 3]>,
    pub pooled_matrix: Vec<Vec<Option<String>>>,
    pub cleaned_matrix: Vec<Vec<Option<String>>>,
    pub final_matrix: Vec<Vec<Option<String>>>,
}

pub fn debug_pipeline(
    bytes: &[u8],
    options: GenerateOptions,
) -> Result<DebugPipelineOutput, EngineError> {
    debug_pipeline_inner(bytes, options, None)
}

pub fn debug_pipeline_with_subpalette_codes(
    bytes: &[u8],
    options: GenerateOptions,
    subpalette_codes: &[String],
) -> Result<DebugPipelineOutput, EngineError> {
    debug_pipeline_inner(bytes, options, Some(subpalette_codes))
}

fn debug_pipeline_inner(
    bytes: &[u8],
    options: GenerateOptions,
    forced_subpalette_codes: Option<&[String]>,
) -> Result<DebugPipelineOutput, EngineError> {
    let image = decode_rgb_image(bytes)?;
    let original_crc32 = crc32_hash(image.as_raw());
    let palette = global_palette();
    let (contrasted, mean_gray, p5, p95, contrast_factor) =
        apply_contrast_debug(&image, options.contrast);
    let contrast_crc32 = crc32_hash(contrasted.as_raw());
    let saturated = apply_saturation(&contrasted, options.saturation);
    let saturation_crc32 = crc32_hash(saturated.as_raw());
    let sharpened = apply_sharpness(&saturated, options.sharpness);
    let sharpness_crc32 = crc32_hash(sharpened.as_raw());
    let mut image = sharpened;
    let preprocessed_crc32 = sharpness_crc32;
    image = consolidate_extremes(image);
    let consolidated_crc32 = crc32_hash(image.as_raw());
    let preset_indices = palette.get_preset_indices(&options.palette_preset);
    let palette_limit = if options.max_colors > 0 {
        options.max_colors
    } else {
        estimate_color_count(&image, options.grid_width, options.grid_height)
    };
    let selection_image = resize_lanczos_pillow(&image, 120, 120);
    let selection_crc32 = crc32_hash(selection_image.as_raw());
    let selection_pixels = selection_image
        .pixels()
        .map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect::<Vec<_>>();
    let mapped_selection = selection_pixels
        .iter()
        .map(|pixel| closest_palette_global(palette, *pixel, preset_indices.as_deref()))
        .collect::<Vec<_>>();
    let mut selection_counts = BTreeMap::<usize, usize>::new();
    for index in mapped_selection {
        *selection_counts.entry(index).or_insert(0) += 1;
    }
    let mut selection_ranked = selection_counts.into_iter().collect::<Vec<_>>();
    selection_ranked.sort_unstable_by(|lhs, rhs| rhs.1.cmp(&lhs.1).then_with(|| lhs.0.cmp(&rhs.0)));
    let sub_palette = if let Some(codes) = forced_subpalette_codes {
        let mut indices = codes
            .iter()
            .filter_map(|code| palette.get_index_by_code(code))
            .collect::<Vec<_>>();
        indices.sort_unstable();
        indices
    } else {
        select_top_n_colors(
            palette,
            &selection_pixels,
            palette_limit,
            preset_indices.as_deref(),
        )
    };
    let mid_image = resize_lanczos_pillow(
        &image,
        (options.grid_width * POOL_FACTOR) as u32,
        (options.grid_height * POOL_FACTOR) as u32,
    );
    let mid_crc32 = crc32_hash(mid_image.as_raw());
    let quantized_local = if options.use_dithering {
        dither_to_subpalette(&mid_image, palette, &sub_palette)
    } else {
        quantize_to_subpalette(&mid_image, palette, &sub_palette)
    };
    let pooled_matrix_indices = mode_pool_to_matrix(
        &quantized_local,
        &sub_palette,
        options.grid_width,
        options.grid_height,
    );
    let mut final_matrix_indices = pooled_matrix_indices.clone();
    let total_pixels = options.grid_width * options.grid_height;
    cleanup_rare_colors(&mut final_matrix_indices, palette, total_pixels, 0.005);
    let cleaned_matrix = render_pixel_matrix(&final_matrix_indices, palette);
    if options.similarity_threshold > 0 {
        merge_similar_colors(
            &mut final_matrix_indices,
            palette,
            options.similarity_threshold as f64,
        );
    }
    if options.max_colors > 0 {
        cap_max_colors(&mut final_matrix_indices, palette, options.max_colors);
    }
    smooth_edges(&mut final_matrix_indices, palette);
    if options.remove_bg {
        remove_background_flood_fill(&mut final_matrix_indices);
    }

    Ok(DebugPipelineOutput {
        subpalette_codes: sub_palette
            .iter()
            .map(|index| palette.get_color(*index).unwrap().code.clone())
            .collect(),
        selection_ranked: selection_ranked
            .into_iter()
            .map(|(index, count)| (palette.get_color(index).unwrap().code.clone(), count))
            .collect(),
        original_crc32,
        mean_gray,
        p5,
        p95,
        contrast_factor,
        contrast_crc32,
        saturation_crc32,
        sharpness_crc32,
        preprocessed_crc32,
        consolidated_crc32,
        selection_crc32,
        mid_crc32,
        selection_image_pixels: selection_pixels,
        pooled_matrix: render_pixel_matrix(&pooled_matrix_indices, palette),
        cleaned_matrix,
        final_matrix: render_pixel_matrix(&final_matrix_indices, palette),
    })
}

fn process_rgb_image(
    mut image: RgbImage,
    palette: &ArtkalPalette,
    options: &GenerateOptions,
) -> Result<EngineOutput, EngineError> {
    let (img_width, img_height) = image.dimensions();
    let mut grid_width = options.grid_width;
    let mut grid_height = options.grid_height;
    if options.mode == "pixel_size" {
        grid_width = ((img_width as usize) / options.pixel_size).max(1);
        grid_height = ((img_height as usize) / options.pixel_size).max(1);
    }

    image = preprocess_image(
        image,
        options.contrast,
        options.saturation,
        options.sharpness,
    );
    image = consolidate_extremes(image);

    let preset_indices = palette.get_preset_indices(&options.palette_preset);
    let palette_limit = if options.max_colors > 0 {
        options.max_colors
    } else {
        estimate_color_count(&image, grid_width, grid_height)
    };

    let selection_image = resize_lanczos_pillow(&image, 120, 120);
    let selection_pixels = selection_image
        .pixels()
        .map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect::<Vec<_>>();
    let sub_palette = select_top_n_colors(
        palette,
        &selection_pixels,
        palette_limit,
        preset_indices.as_deref(),
    );

    let mid_image = resize_lanczos_pillow(
        &image,
        (grid_width * POOL_FACTOR) as u32,
        (grid_height * POOL_FACTOR) as u32,
    );

    let quantized_local = if options.use_dithering {
        dither_to_subpalette(&mid_image, palette, &sub_palette)
    } else {
        quantize_to_subpalette(&mid_image, palette, &sub_palette)
    };

    let mut matrix = mode_pool_to_matrix(&quantized_local, &sub_palette, grid_width, grid_height);
    let total_pixels = grid_width * grid_height;
    cleanup_rare_colors(&mut matrix, palette, total_pixels, 0.005);
    if options.similarity_threshold > 0 {
        merge_similar_colors(&mut matrix, palette, options.similarity_threshold as f64);
    }
    if options.max_colors > 0 {
        cap_max_colors(&mut matrix, palette, options.max_colors);
    }
    smooth_edges(&mut matrix, palette);
    if options.remove_bg {
        remove_background_flood_fill(&mut matrix);
    }

    let (pixel_matrix, color_summary, total_beads) =
        render_pixel_matrix_and_summary(&matrix, palette);
    let preview_image = String::new();

    Ok(EngineOutput {
        grid_size: GridSize {
            width: grid_width,
            height: grid_height,
        },
        pixel_matrix,
        color_summary,
        total_beads,
        preview_image,
    })
}

fn decode_rgb_image(bytes: &[u8]) -> Result<RgbImage, EngineError> {
    let _ = image::guess_format(bytes)?;
    Ok(ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()?
        .decode()?
        .to_rgb8())
}

fn apply_contrast(image: &RgbImage, contrast: f32) -> RgbImage {
    let (contrast_factor, mean_gray, _, _) = contrast_parameters(image, contrast);
    RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let pixel = image.get_pixel(x, y);
        Rgb([
            blend_channel(mean_gray, pixel[0], contrast_factor),
            blend_channel(mean_gray, pixel[1], contrast_factor),
            blend_channel(mean_gray, pixel[2], contrast_factor),
        ])
    })
}

fn apply_contrast_debug(image: &RgbImage, contrast: f32) -> (RgbImage, u8, usize, usize, f32) {
    let (contrast_factor, mean_gray, p5, p95) = contrast_parameters(image, contrast);
    let contrasted = RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let pixel = image.get_pixel(x, y);
        Rgb([
            blend_channel(mean_gray, pixel[0], contrast_factor),
            blend_channel(mean_gray, pixel[1], contrast_factor),
            blend_channel(mean_gray, pixel[2], contrast_factor),
        ])
    });
    (contrasted, mean_gray, p5, p95, contrast_factor)
}

fn contrast_parameters(image: &RgbImage, contrast: f32) -> (f32, u8, usize, usize) {
    let (contrast_factor, p5, p95) = if contrast == 0.0 {
        let hist = build_histogram(image);
        let total: u64 = hist.iter().sum();
        let lower = (total as f64) * 0.05;
        let upper = (total as f64) * 0.95;
        let mut cumulative = 0u64;
        let mut p5 = 0usize;
        let mut p95 = 255usize;
        let mut found_low = false;
        for (idx, count) in hist.iter().enumerate() {
            cumulative += *count;
            let cumulative_f64 = cumulative as f64;
            if !found_low && cumulative_f64 >= lower {
                p5 = idx;
                found_low = true;
            }
            if cumulative_f64 >= upper {
                p95 = idx;
                break;
            }
        }
        let spread = p95 as i32 - p5 as i32;
        let factor = if spread < 100 {
            1.25
        } else if spread < 160 {
            1.15
        } else {
            1.05
        };
        (factor, p5, p95)
    } else {
        ((1.0 + contrast / 100.0).clamp(0.5, 1.5), 0, 255)
    };
    let mean_gray = mean_grayscale(image);
    (contrast_factor, mean_gray, p5, p95)
}

fn apply_saturation(image: &RgbImage, saturation: f32) -> RgbImage {
    let saturation_factor = if saturation == 0.0 {
        1.1
    } else {
        (1.0 + saturation / 100.0).clamp(0.5, 1.5)
    };
    RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let pixel = image.get_pixel(x, y);
        let gray = grayscale_u8([pixel[0], pixel[1], pixel[2]]);
        Rgb([
            blend_channel(gray, pixel[0], saturation_factor),
            blend_channel(gray, pixel[1], saturation_factor),
            blend_channel(gray, pixel[2], saturation_factor),
        ])
    })
}

fn apply_sharpness(image: &RgbImage, sharpness: f32) -> RgbImage {
    let sharpness_factor = if sharpness == 0.0 {
        1.3
    } else {
        (1.0 + sharpness / 50.0).clamp(0.0, 2.0)
    };
    let smooth = smooth_image(image);
    RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let src = image.get_pixel(x, y);
        let deg = smooth.get_pixel(x, y);
        Rgb([
            blend_channel(deg[0], src[0], sharpness_factor),
            blend_channel(deg[1], src[1], sharpness_factor),
            blend_channel(deg[2], src[2], sharpness_factor),
        ])
    })
}

fn preprocess_image(image: RgbImage, contrast: f32, saturation: f32, sharpness: f32) -> RgbImage {
    let contrasted = apply_contrast(&image, contrast);
    let saturated = apply_saturation(&contrasted, saturation);
    apply_sharpness(&saturated, sharpness)
}

fn consolidate_extremes(image: RgbImage) -> RgbImage {
    const DARK_LIMIT: f64 = 80.0;
    const LIGHT_LIMIT: f64 = 210.0;

    RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let pixel = image.get_pixel(x, y);
        let mut rgb = [
            f64::from(pixel[0]),
            f64::from(pixel[1]),
            f64::from(pixel[2]),
        ];
        let luma = grayscale_f64(rgb);
        if luma < DARK_LIMIT {
            let factor = luma / DARK_LIMIT;
            rgb.iter_mut().for_each(|channel| {
                *channel = luma + factor * (*channel - luma);
            });
        } else if luma > LIGHT_LIMIT {
            let factor = (255.0 - luma) / (255.0 - LIGHT_LIMIT);
            rgb.iter_mut().for_each(|channel| {
                *channel = luma + factor * (*channel - luma);
            });
        }
        Rgb([
            rgb[0].clamp(0.0, 255.0) as u8,
            rgb[1].clamp(0.0, 255.0) as u8,
            rgb[2].clamp(0.0, 255.0) as u8,
        ])
    })
}

fn estimate_color_count(image: &RgbImage, grid_width: usize, grid_height: usize) -> usize {
    let small = resize_lanczos_pillow(image, 80, 80);
    let pixels = small
        .pixels()
        .map(|pixel| {
            [
                f64::from(pixel[0]),
                f64::from(pixel[1]),
                f64::from(pixel[2]),
            ]
        })
        .collect::<Vec<_>>();
    let count = pixels.len() as f64;
    let means = pixels.iter().fold([0.0; 3], |mut acc, rgb| {
        acc[0] += rgb[0];
        acc[1] += rgb[1];
        acc[2] += rgb[2];
        acc
    });
    let means = [means[0] / count, means[1] / count, means[2] / count];
    let variances = pixels.iter().fold([0.0; 3], |mut acc, rgb| {
        acc[0] += (rgb[0] - means[0]).powi(2);
        acc[1] += (rgb[1] - means[1]).powi(2);
        acc[2] += (rgb[2] - means[2]).powi(2);
        acc
    });
    let total_var = variances[0] / count + variances[1] / count + variances[2] / count;
    let mut n = (12.0 + (total_var - 500.0) * 28.0 / 3500.0) as isize;
    n = n.clamp(12, 40);
    if grid_width * grid_height > 48 * 48 {
        n = (n + 5).min(40);
    } else if grid_width * grid_height < 29 * 29 {
        n = (n - 3).max(12);
    }
    n as usize
}

fn pack_rgb_key(rgb: [u8; 3]) -> u32 {
    (u32::from(rgb[0]) << 16) | (u32::from(rgb[1]) << 8) | u32::from(rgb[2])
}

struct GlobalPaletteMatcher<'a> {
    palette: &'a ArtkalPalette,
    allowed_indices: Option<&'a [usize]>,
    cache: HashMap<u32, usize>,
}

impl<'a> GlobalPaletteMatcher<'a> {
    fn new(palette: &'a ArtkalPalette, allowed_indices: Option<&'a [usize]>) -> Self {
        Self {
            palette,
            allowed_indices,
            cache: HashMap::new(),
        }
    }

    fn closest(&mut self, rgb: [u8; 3]) -> usize {
        let key = pack_rgb_key(rgb);
        if let Some(index) = self.cache.get(&key) {
            return *index;
        }
        let index = closest_palette_global(self.palette, rgb, self.allowed_indices);
        self.cache.insert(key, index);
        index
    }
}

struct SubPaletteMatcher<'a> {
    candidate_rgbs: Vec<[u8; 3]>,
    cache: HashMap<u32, usize>,
    _palette: &'a ArtkalPalette,
}

impl<'a> SubPaletteMatcher<'a> {
    fn new(palette: &'a ArtkalPalette, sub_palette: &[usize]) -> Self {
        let candidate_rgbs = sub_palette
            .iter()
            .map(|index| palette.get_color(*index).unwrap().rgb)
            .collect::<Vec<_>>();
        Self {
            candidate_rgbs,
            cache: HashMap::new(),
            _palette: palette,
        }
    }

    fn closest(&mut self, rgb: [u8; 3]) -> usize {
        let reduced = reduce_rgb_for_palette_lookup(rgb);
        let key = pack_rgb_key(reduced);
        if let Some(index) = self.cache.get(&key) {
            return *index;
        }

        let mut best_local = 0usize;
        let mut best_distance = u32::MAX;
        for (local_idx, candidate) in self.candidate_rgbs.iter().enumerate() {
            let distance = rgb_distance_squared(reduced, *candidate);
            if distance < best_distance {
                best_distance = distance;
                best_local = local_idx;
            }
        }
        self.cache.insert(key, best_local);
        best_local
    }
}

fn select_top_n_colors(
    palette: &ArtkalPalette,
    pixels: &[[u8; 3]],
    n: usize,
    allowed_indices: Option<&[usize]>,
) -> Vec<usize> {
    let mut matcher = GlobalPaletteMatcher::new(palette, allowed_indices);
    let mapped = pixels
        .iter()
        .map(|pixel| matcher.closest(*pixel))
        .collect::<Vec<_>>();
    let mut counts = BTreeMap::<usize, usize>::new();
    for index in mapped {
        *counts.entry(index).or_insert(0) += 1;
    }
    let mut ranked = counts.into_iter().collect::<Vec<_>>();
    ranked.sort_unstable_by(|lhs, rhs| rhs.1.cmp(&lhs.1).then_with(|| rhs.0.cmp(&lhs.0)));
    let mut selected = ranked
        .into_iter()
        .take(n)
        .map(|(idx, _)| idx)
        .collect::<Vec<_>>();
    selected.sort_unstable();
    selected
}

fn quantize_to_subpalette(
    image: &RgbImage,
    palette: &ArtkalPalette,
    sub_palette: &[usize],
) -> Vec<usize> {
    let mut matcher = SubPaletteMatcher::new(palette, sub_palette);
    image
        .as_raw()
        .chunks_exact(3)
        .map(|pixel| matcher.closest([pixel[0], pixel[1], pixel[2]]))
        .collect()
}

fn dither_to_subpalette(
    image: &RgbImage,
    palette: &ArtkalPalette,
    sub_palette: &[usize],
) -> Vec<usize> {
    let width = image.width() as usize;
    let height = image.height() as usize;
    let mut working = image
        .pixels()
        .map(|pixel| {
            [
                f64::from(pixel[0]),
                f64::from(pixel[1]),
                f64::from(pixel[2]),
            ]
        })
        .collect::<Vec<_>>();
    let mut result = vec![0usize; working.len()];
    let mut matcher = SubPaletteMatcher::new(palette, sub_palette);

    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;
            let old_pixel = [
                working[idx][0].clamp(0.0, 255.0) as u8,
                working[idx][1].clamp(0.0, 255.0) as u8,
                working[idx][2].clamp(0.0, 255.0) as u8,
            ];
            let local = matcher.closest(old_pixel);
            result[idx] = local;
            let new_rgb = palette.get_color(sub_palette[local]).unwrap().rgb;
            let error = [
                f64::from(old_pixel[0]) - f64::from(new_rgb[0]),
                f64::from(old_pixel[1]) - f64::from(new_rgb[1]),
                f64::from(old_pixel[2]) - f64::from(new_rgb[2]),
            ];
            diffuse_error(&mut working, width, height, x, y, error);
        }
    }
    result
}

fn diffuse_error(
    buffer: &mut [[f64; 3]],
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    error: [f64; 3],
) {
    let mut spread = |tx: isize, ty: isize, weight: f64| {
        if tx < 0 || ty < 0 {
            return;
        }
        let tx = tx as usize;
        let ty = ty as usize;
        if tx >= width || ty >= height {
            return;
        }
        let idx = ty * width + tx;
        for channel in 0..3 {
            buffer[idx][channel] += error[channel] * weight;
        }
    };

    let x = x as isize;
    let y = y as isize;
    spread(x + 1, y, 7.0 / 16.0);
    spread(x - 1, y + 1, 3.0 / 16.0);
    spread(x, y + 1, 5.0 / 16.0);
    spread(x + 1, y + 1, 1.0 / 16.0);
}

fn closest_palette_global(
    palette: &ArtkalPalette,
    rgb: [u8; 3],
    allowed_indices: Option<&[usize]>,
) -> usize {
    let lab = rgb_to_lab(rgb);
    match allowed_indices {
        Some(indices) if !indices.is_empty() => {
            let mut best_index = indices[0];
            let mut best_distance = f64::MAX;
            for index in indices {
                let distance = lab_distance(lab, palette.lab(*index));
                if distance < best_distance {
                    best_distance = distance;
                    best_index = *index;
                }
            }
            best_index
        }
        _ => {
            let mut best_index = 0usize;
            let mut best_distance = f64::MAX;
            for index in 0..palette.colors.len() {
                let distance = lab_distance(lab, palette.lab(index));
                if distance < best_distance {
                    best_distance = distance;
                    best_index = index;
                }
            }
            best_index
        }
    }
}

#[cfg(test)]
fn closest_subpalette_local(palette: &ArtkalPalette, rgb: [u8; 3], sub_palette: &[usize]) -> usize {
    let reduced = reduce_rgb_for_palette_lookup(rgb);
    let mut best_local = 0usize;
    let mut best_distance = u32::MAX;
    for (local_idx, global_idx) in sub_palette.iter().enumerate() {
        let candidate = palette.get_color(*global_idx).unwrap().rgb;
        let distance = rgb_distance_squared(reduced, candidate);
        if distance < best_distance {
            best_distance = distance;
            best_local = local_idx;
        }
    }
    best_local
}

fn reduce_rgb_for_palette_lookup(rgb: [u8; 3]) -> [u8; 3] {
    [rgb[0] & !0b11, rgb[1] & !0b11, rgb[2] & !0b11]
}

fn rgb_distance_squared(lhs: [u8; 3], rhs: [u8; 3]) -> u32 {
    let dr = i32::from(lhs[0]) - i32::from(rhs[0]);
    let dg = i32::from(lhs[1]) - i32::from(rhs[1]);
    let db = i32::from(lhs[2]) - i32::from(rhs[2]);
    (dr * dr + dg * dg + db * db) as u32
}

fn mode_pool_to_matrix(
    quantized_local: &[usize],
    sub_palette: &[usize],
    grid_width: usize,
    grid_height: usize,
) -> Vec<Vec<Option<usize>>> {
    let mid_width = grid_width * POOL_FACTOR;
    let mut matrix = vec![vec![None; grid_width]; grid_height];
    let mut counts = vec![0usize; sub_palette.len()];

    for y in 0..grid_height {
        for x in 0..grid_width {
            counts.fill(0);
            for by in 0..POOL_FACTOR {
                for bx in 0..POOL_FACTOR {
                    let idx = (y * POOL_FACTOR + by) * mid_width + (x * POOL_FACTOR + bx);
                    counts[quantized_local[idx]] += 1;
                }
            }
            let mut best_local = 0usize;
            let mut best_count = 0usize;
            for (local_idx, count) in counts.iter().enumerate() {
                if *count > best_count {
                    best_count = *count;
                    best_local = local_idx;
                }
            }
            matrix[y][x] = Some(sub_palette[best_local]);
        }
    }

    matrix
}

fn cleanup_rare_colors(
    matrix: &mut [Vec<Option<usize>>],
    palette: &ArtkalPalette,
    total_pixels: usize,
    min_ratio: f64,
) {
    let mut freq = HashMap::<usize, usize>::new();
    for row in matrix.iter() {
        for code in row.iter().flatten() {
            *freq.entry(*code).or_insert(0) += 1;
        }
    }

    let min_count = ((total_pixels as f64) * min_ratio).floor() as usize;
    let min_count = min_count.max(2);
    let kept = freq
        .iter()
        .filter_map(|(code, count)| {
            if *count >= min_count {
                Some(*code)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if kept.is_empty() {
        return;
    }

    let rare = freq
        .keys()
        .filter(|code| !kept.contains(code))
        .copied()
        .collect::<Vec<_>>();
    let mut remap = HashMap::<usize, usize>::new();
    for rare_code in rare {
        if let Some(replacement) = kept.iter().copied().min_by(|lhs, rhs| {
            let lhs_distance = lab_distance(palette.lab(rare_code), palette.lab(*lhs));
            let rhs_distance = lab_distance(palette.lab(rare_code), palette.lab(*rhs));
            lhs_distance
                .partial_cmp(&rhs_distance)
                .unwrap_or(std::cmp::Ordering::Equal)
        }) {
            remap.insert(rare_code, replacement);
        }
    }
    apply_remap(matrix, &remap);
}

fn merge_similar_colors(
    matrix: &mut [Vec<Option<usize>>],
    palette: &ArtkalPalette,
    threshold: f64,
) {
    let mut freq = HashMap::<usize, usize>::new();
    for row in matrix.iter() {
        for code in row.iter().flatten() {
            *freq.entry(*code).or_insert(0) += 1;
        }
    }
    let mut ranked = freq.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|lhs, rhs| rhs.1.cmp(&lhs.1).then_with(|| lhs.0.cmp(&rhs.0)));
    let ordered = ranked.iter().map(|(code, _)| *code).collect::<Vec<_>>();
    let mut merge_map = HashMap::<usize, usize>::new();
    let mut replaced = Vec::<usize>::new();

    for (idx, current) in ordered.iter().enumerate() {
        if replaced.contains(current) {
            continue;
        }
        for lower in ordered.iter().skip(idx + 1) {
            if replaced.contains(lower) {
                continue;
            }
            if lab_distance(palette.lab(*current), palette.lab(*lower)) < threshold {
                replaced.push(*lower);
                merge_map.insert(*lower, *current);
            }
        }
    }

    apply_remap(matrix, &merge_map);
}

fn cap_max_colors(matrix: &mut [Vec<Option<usize>>], palette: &ArtkalPalette, max_colors: usize) {
    let mut freq = HashMap::<usize, usize>::new();
    for row in matrix.iter() {
        for code in row.iter().flatten() {
            *freq.entry(*code).or_insert(0) += 1;
        }
    }
    if freq.len() <= max_colors {
        return;
    }
    let mut ranked = freq.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|lhs, rhs| rhs.1.cmp(&lhs.1).then_with(|| lhs.0.cmp(&rhs.0)));
    let kept = ranked
        .iter()
        .take(max_colors)
        .map(|(code, _)| *code)
        .collect::<Vec<_>>();
    let mut remap = HashMap::<usize, usize>::new();
    for (removed, _) in ranked.iter().skip(max_colors) {
        if let Some(replacement) = kept.iter().copied().min_by(|lhs, rhs| {
            let lhs_distance = lab_distance(palette.lab(*removed), palette.lab(*lhs));
            let rhs_distance = lab_distance(palette.lab(*removed), palette.lab(*rhs));
            lhs_distance
                .partial_cmp(&rhs_distance)
                .unwrap_or(std::cmp::Ordering::Equal)
        }) {
            remap.insert(*removed, replacement);
        }
    }
    apply_remap(matrix, &remap);
}

fn smooth_edges(matrix: &mut [Vec<Option<usize>>], palette: &ArtkalPalette) {
    let snapshot = matrix.to_vec();
    let height = snapshot.len();
    let width = snapshot.first().map(|row| row.len()).unwrap_or(0);

    for y in 0..height {
        for x in 0..width {
            let current = match snapshot[y][x] {
                Some(value) => value,
                None => continue,
            };
            let neighbors = collect_neighbors(&snapshot, x, y);
            if neighbors.is_empty() || neighbors.iter().any(|neighbor| *neighbor == current) {
                continue;
            }
            let replacement = most_common_neighbor(&neighbors);
            if lab_distance(palette.lab(current), palette.lab(replacement)) > 30.0 {
                continue;
            }
            matrix[y][x] = Some(replacement);
        }
    }
}

fn collect_neighbors(matrix: &[Vec<Option<usize>>], x: usize, y: usize) -> Vec<usize> {
    let mut neighbors = Vec::new();
    let height = matrix.len();
    let width = matrix.first().map(|row| row.len()).unwrap_or(0);
    if y > 0 {
        if let Some(value) = matrix[y - 1][x] {
            neighbors.push(value);
        }
    }
    if y + 1 < height {
        if let Some(value) = matrix[y + 1][x] {
            neighbors.push(value);
        }
    }
    if x > 0 {
        if let Some(value) = matrix[y][x - 1] {
            neighbors.push(value);
        }
    }
    if x + 1 < width {
        if let Some(value) = matrix[y][x + 1] {
            neighbors.push(value);
        }
    }
    neighbors
}

fn most_common_neighbor(values: &[usize]) -> usize {
    let mut counts = HashMap::<usize, usize>::new();
    let mut first_seen = HashMap::<usize, usize>::new();
    for (idx, value) in values.iter().enumerate() {
        *counts.entry(*value).or_insert(0) += 1;
        first_seen.entry(*value).or_insert(idx);
    }
    counts
        .into_iter()
        .max_by(|(lhs_value, lhs_count), (rhs_value, rhs_count)| {
            lhs_count.cmp(rhs_count).then_with(|| {
                let lhs_idx = first_seen.get(lhs_value).copied().unwrap_or(usize::MAX);
                let rhs_idx = first_seen.get(rhs_value).copied().unwrap_or(usize::MAX);
                rhs_idx.cmp(&lhs_idx)
            })
        })
        .map(|(value, _)| value)
        .unwrap_or(values[0])
}

fn remove_background_flood_fill(matrix: &mut [Vec<Option<usize>>]) {
    let height = matrix.len();
    let width = matrix.first().map(|row| row.len()).unwrap_or(0);
    if height == 0 || width == 0 {
        return;
    }

    let mut border = Vec::new();
    for x in 0..width {
        if let Some(value) = matrix[0][x] {
            border.push(value);
        }
        if height > 1 {
            if let Some(value) = matrix[height - 1][x] {
                border.push(value);
            }
        }
    }
    for row in matrix.iter().take(height.saturating_sub(1)).skip(1) {
        if let Some(value) = row[0] {
            border.push(value);
        }
        if width > 1 {
            if let Some(value) = row[width - 1] {
                border.push(value);
            }
        }
    }
    if border.is_empty() {
        return;
    }
    let background = most_common_neighbor(&border);
    let mut visited = vec![vec![false; width]; height];
    let mut stack = Vec::<(usize, usize)>::new();

    let push = |stack: &mut Vec<(usize, usize)>,
                visited: &mut [Vec<bool>],
                matrix: &[Vec<Option<usize>>],
                row: usize,
                col: usize| {
        if !visited[row][col] && matrix[row][col] == Some(background) {
            visited[row][col] = true;
            stack.push((row, col));
        }
    };

    for x in 0..width {
        push(&mut stack, &mut visited, matrix, 0, x);
        push(&mut stack, &mut visited, matrix, height - 1, x);
    }
    for y in 1..height.saturating_sub(1) {
        push(&mut stack, &mut visited, matrix, y, 0);
        push(&mut stack, &mut visited, matrix, y, width - 1);
    }

    while let Some((row, col)) = stack.pop() {
        matrix[row][col] = None;
        if row > 0 {
            push(&mut stack, &mut visited, matrix, row - 1, col);
        }
        if row + 1 < height {
            push(&mut stack, &mut visited, matrix, row + 1, col);
        }
        if col > 0 {
            push(&mut stack, &mut visited, matrix, row, col - 1);
        }
        if col + 1 < width {
            push(&mut stack, &mut visited, matrix, row, col + 1);
        }
    }
}

fn apply_remap(matrix: &mut [Vec<Option<usize>>], remap: &HashMap<usize, usize>) {
    for row in matrix.iter_mut() {
        for cell in row.iter_mut() {
            if let Some(next) = cell.and_then(|current| remap.get(&current).copied()) {
                *cell = Some(next);
            }
        }
    }
}

fn render_pixel_matrix(
    matrix: &[Vec<Option<usize>>],
    palette: &ArtkalPalette,
) -> Vec<Vec<Option<String>>> {
    matrix
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| {
                    cell.and_then(|index| palette.get_color(index).map(|color| color.code.clone()))
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn render_pixel_matrix_and_summary(
    matrix: &[Vec<Option<usize>>],
    palette: &ArtkalPalette,
) -> (Vec<Vec<Option<String>>>, Vec<ColorSummaryEntry>, usize) {
    let mut counts = HashMap::<String, usize>::new();
    let mut first_seen = HashMap::<String, usize>::new();
    let mut metadata = HashMap::<String, (String, String, String, [u8; 3])>::new();
    let mut order = 0usize;
    let mut total_beads = 0usize;

    let pixel_matrix = matrix
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| {
                    let color = palette.get_color((*cell)?)?;
                    let code = color.code.clone();
                    *counts.entry(code.clone()).or_insert(0) += 1;
                    first_seen.entry(code.clone()).or_insert_with(|| {
                        let current = order;
                        order += 1;
                        current
                    });
                    metadata.entry(code.clone()).or_insert_with(|| {
                        (
                            color.name.clone(),
                            color.name_zh.clone(),
                            color.hex.clone(),
                            color.rgb,
                        )
                    });
                    total_beads += 1;
                    Some(code)
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    let mut ranked = counts.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|lhs, rhs| {
        rhs.1.cmp(&lhs.1).then_with(|| {
            let lhs_idx = first_seen.get(&lhs.0).copied().unwrap_or(usize::MAX);
            let rhs_idx = first_seen.get(&rhs.0).copied().unwrap_or(usize::MAX);
            lhs_idx.cmp(&rhs_idx)
        })
    });
    let color_summary = ranked
        .into_iter()
        .filter_map(|(code, count)| {
            let (name, name_zh, hex, rgb) = metadata.get(&code)?.clone();
            Some(ColorSummaryEntry {
                code,
                name,
                name_zh,
                hex,
                rgb,
                count,
            })
        })
        .collect::<Vec<_>>();

    (pixel_matrix, color_summary, total_beads)
}

#[cfg(test)]
fn build_color_summary(
    pixel_matrix: &[Vec<Option<String>>],
    palette: &ArtkalPalette,
) -> Vec<ColorSummaryEntry> {
    let mut counts = HashMap::<String, usize>::new();
    let mut first_seen = HashMap::<String, usize>::new();
    let mut order = 0usize;
    for row in pixel_matrix {
        for code in row.iter().flatten() {
            *counts.entry(code.clone()).or_insert(0) += 1;
            first_seen.entry(code.clone()).or_insert_with(|| {
                let current = order;
                order += 1;
                current
            });
        }
    }
    let mut ranked = counts.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|lhs, rhs| {
        rhs.1.cmp(&lhs.1).then_with(|| {
            let lhs_idx = first_seen.get(&lhs.0).copied().unwrap_or(usize::MAX);
            let rhs_idx = first_seen.get(&rhs.0).copied().unwrap_or(usize::MAX);
            lhs_idx.cmp(&rhs_idx)
        })
    });
    ranked
        .into_iter()
        .filter_map(|(code, count)| {
            let color = palette.get_by_code(&code)?;
            Some(ColorSummaryEntry {
                code,
                name: color.name.clone(),
                name_zh: color.name_zh.clone(),
                hex: color.hex.clone(),
                rgb: color.rgb,
                count,
            })
        })
        .collect()
}

fn resize_lanczos_pillow(image: &RgbImage, out_width: u32, out_height: u32) -> RgbImage {
    if image.width() == out_width && image.height() == out_height {
        return image.clone();
    }

    let horizontal = if image.width() == out_width {
        image.clone()
    } else {
        resize_axis_pillow(image, out_width as usize, Axis::Horizontal)
    };

    if horizontal.height() == out_height {
        horizontal
    } else {
        resize_axis_pillow(&horizontal, out_height as usize, Axis::Vertical)
    }
}

#[derive(Clone, Copy)]
enum Axis {
    Horizontal,
    Vertical,
}

fn resize_axis_pillow(image: &RgbImage, out_size: usize, axis: Axis) -> RgbImage {
    let (in_size, other_size) = match axis {
        Axis::Horizontal => (image.width() as usize, image.height() as usize),
        Axis::Vertical => (image.height() as usize, image.width() as usize),
    };
    let (bounds, coeffs, ksize) = precompute_lanczos_coeffs(in_size, out_size);

    let mut out = match axis {
        Axis::Horizontal => RgbImage::new(out_size as u32, other_size as u32),
        Axis::Vertical => RgbImage::new(other_size as u32, out_size as u32),
    };

    let half = 1 << (RESAMPLE_PRECISION_BITS - 1);
    match axis {
        Axis::Horizontal => {
            for y in 0..other_size {
                for xx in 0..out_size {
                    let (xmin, xmax) = bounds[xx];
                    let kernel = &coeffs[xx * ksize..(xx + 1) * ksize];
                    let mut sums = [half, half, half];
                    for x in 0..xmax {
                        let pixel = image.get_pixel((xmin + x) as u32, y as u32);
                        sums[0] += i32::from(pixel[0]) * kernel[x];
                        sums[1] += i32::from(pixel[1]) * kernel[x];
                        sums[2] += i32::from(pixel[2]) * kernel[x];
                    }
                    out.put_pixel(
                        xx as u32,
                        y as u32,
                        Rgb([
                            clip8_precision(sums[0]),
                            clip8_precision(sums[1]),
                            clip8_precision(sums[2]),
                        ]),
                    );
                }
            }
        }
        Axis::Vertical => {
            for yy in 0..out_size {
                let (ymin, ymax) = bounds[yy];
                let kernel = &coeffs[yy * ksize..(yy + 1) * ksize];
                for x in 0..other_size {
                    let mut sums = [half, half, half];
                    for y in 0..ymax {
                        let pixel = image.get_pixel(x as u32, (ymin + y) as u32);
                        sums[0] += i32::from(pixel[0]) * kernel[y];
                        sums[1] += i32::from(pixel[1]) * kernel[y];
                        sums[2] += i32::from(pixel[2]) * kernel[y];
                    }
                    out.put_pixel(
                        x as u32,
                        yy as u32,
                        Rgb([
                            clip8_precision(sums[0]),
                            clip8_precision(sums[1]),
                            clip8_precision(sums[2]),
                        ]),
                    );
                }
            }
        }
    }

    out
}

fn precompute_lanczos_coeffs(
    in_size: usize,
    out_size: usize,
) -> (Vec<(usize, usize)>, Vec<i32>, usize) {
    let scale = (in_size as f64) / (out_size as f64);
    let filterscale = scale.max(1.0);
    let support = 3.0 * filterscale;
    let ksize = support.ceil() as usize * 2 + 1;
    let mut bounds = Vec::with_capacity(out_size);
    let mut coeffs = vec![0i32; out_size * ksize];

    for xx in 0..out_size {
        let center = (xx as f64 + 0.5) * scale;
        let ss = 1.0 / filterscale;
        let mut xmin = (center - support + 0.5) as isize;
        if xmin < 0 {
            xmin = 0;
        }
        let mut xmax = (center + support + 0.5) as isize;
        if xmax > in_size as isize {
            xmax = in_size as isize;
        }
        let xmin_usize = xmin as usize;
        let xmax_count = (xmax - xmin) as usize;
        let coeff_slice = &mut coeffs[xx * ksize..(xx + 1) * ksize];

        let mut weight_sum = 0.0f64;
        for x in 0..xmax_count {
            let weight = lanczos_filter(((x + xmin_usize) as f64 - center + 0.5) * ss);
            coeff_slice[x] = weight_to_precision(weight);
            weight_sum += weight;
        }

        if weight_sum != 0.0 {
            for x in 0..xmax_count {
                let weight =
                    lanczos_filter(((x + xmin_usize) as f64 - center + 0.5) * ss) / weight_sum;
                coeff_slice[x] = weight_to_precision(weight);
            }
        }

        bounds.push((xmin_usize, xmax_count));
    }

    (bounds, coeffs, ksize)
}

fn lanczos_filter(x: f64) -> f64 {
    if (-3.0..3.0).contains(&x) {
        sinc_filter(x) * sinc_filter(x / 3.0)
    } else {
        0.0
    }
}

fn sinc_filter(x: f64) -> f64 {
    if x == 0.0 {
        1.0
    } else {
        let x_pi = x * std::f64::consts::PI;
        x_pi.sin() / x_pi
    }
}

fn weight_to_precision(weight: f64) -> i32 {
    let scaled = weight * f64::from(1 << RESAMPLE_PRECISION_BITS);
    if scaled < 0.0 {
        (scaled - 0.5) as i32
    } else {
        (scaled + 0.5) as i32
    }
}

fn clip8_precision(value: i32) -> u8 {
    let shifted = value >> RESAMPLE_PRECISION_BITS;
    shifted.clamp(0, 255) as u8
}

fn build_histogram(image: &RgbImage) -> [u64; 256] {
    let mut hist = [0u64; 256];
    for pixel in image.pixels() {
        let gray = grayscale_u8([pixel[0], pixel[1], pixel[2]]) as usize;
        hist[gray] += 1;
    }
    hist
}

fn mean_grayscale(image: &RgbImage) -> u8 {
    let total = image
        .pixels()
        .map(|pixel| u64::from(grayscale_u8([pixel[0], pixel[1], pixel[2]])))
        .sum::<u64>();
    let count = u64::from(image.width()) * u64::from(image.height());
    ((total as f64 / count as f64) + 0.5).floor() as u8
}

fn blend_channel(base: u8, source: u8, factor: f32) -> u8 {
    let value = f32::from(base) + factor * (f32::from(source) - f32::from(base));
    value.clamp(0.0, 255.0) as u8
}

fn smooth_image(image: &RgbImage) -> RgbImage {
    let width = image.width();
    let height = image.height();
    let kernel = [[1.0f32, 1.0, 1.0], [1.0, 5.0, 1.0], [1.0, 1.0, 1.0]];
    if width < 3 || height < 3 {
        return image.clone();
    }
    let mut out = image.clone();
    for y in 1..(height - 1) {
        for x in 1..(width - 1) {
            let mut sums = [0.5f32; 3];
            for ky in 0..3 {
                for kx in 0..3 {
                    let px = x + kx - 1;
                    let py = y + ky - 1;
                    let weight = kernel[ky as usize][kx as usize];
                    let pixel = image.get_pixel(px, py);
                    sums[0] += f32::from(pixel[0]) * (weight / 13.0);
                    sums[1] += f32::from(pixel[1]) * (weight / 13.0);
                    sums[2] += f32::from(pixel[2]) * (weight / 13.0);
                }
            }
            out.put_pixel(
                x,
                y,
                Rgb([
                    sums[0].clamp(0.0, 255.0) as u8,
                    sums[1].clamp(0.0, 255.0) as u8,
                    sums[2].clamp(0.0, 255.0) as u8,
                ]),
            );
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::palette::global_palette;

    #[test]
    fn global_palette_matcher_matches_uncached_lookup() {
        let palette = global_palette();
        let allowed = (0..palette.colors.len().min(32)).collect::<Vec<_>>();
        let mut matcher = GlobalPaletteMatcher::new(palette, Some(&allowed));

        let samples = [
            [0, 0, 0],
            [12, 34, 56],
            [121, 205, 65],
            [250, 250, 250],
            [196, 128, 32],
            [45, 90, 180],
            [12, 34, 56],
        ];

        for rgb in samples {
            assert_eq!(
                matcher.closest(rgb),
                closest_palette_global(palette, rgb, Some(&allowed))
            );
        }
    }

    #[test]
    fn sub_palette_matcher_matches_uncached_lookup() {
        let palette = global_palette();
        let sub_palette = (0..palette.colors.len().min(16)).collect::<Vec<_>>();
        let mut matcher = SubPaletteMatcher::new(palette, &sub_palette);

        let samples = [
            [0, 0, 0],
            [12, 34, 56],
            [121, 205, 65],
            [250, 250, 250],
            [196, 128, 32],
            [45, 90, 180],
            [12, 34, 56],
        ];

        for rgb in samples {
            assert_eq!(
                matcher.closest(rgb),
                closest_subpalette_local(palette, rgb, &sub_palette)
            );
        }
    }

    #[test]
    fn combined_render_matches_legacy_render_and_summary() {
        let palette = global_palette();
        let matrix = vec![
            vec![Some(0usize), Some(1usize), None],
            vec![Some(1usize), Some(0usize), Some(1usize)],
        ];

        let (pixel_matrix, color_summary, total_beads) =
            render_pixel_matrix_and_summary(&matrix, palette);

        assert_eq!(pixel_matrix, render_pixel_matrix(&matrix, palette));
        assert_eq!(color_summary, build_color_summary(&pixel_matrix, palette));
        assert_eq!(total_beads, 5);
    }
}
