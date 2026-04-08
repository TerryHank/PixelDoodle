use std::{collections::HashMap, io::Cursor};

use chrono::Local;
use font8x8::{BASIC_FONTS, UnicodeFonts};
use image::{
    codecs::png::PngEncoder,
    ColorType, ImageEncoder, Rgb, RgbImage,
};
use printpdf::{Mm, Op, PdfDocument, PdfPage, PdfSaveOptions, Pt, RawImage, XObjectTransform};
use serde::Deserialize;
use thiserror::Error;

use crate::palette::global_palette;

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("pixel_matrix is required")]
    MissingPixelMatrix,
    #[error("invalid export payload: {0}")]
    InvalidPayload(String),
    #[error("png encode failed: {0}")]
    PngEncode(String),
    #[error("pdf render failed: {0}")]
    Pdf(String),
}

#[derive(Debug)]
pub struct BinaryExport {
    pub content_type: String,
    pub filename: String,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExportColorSummaryEntry {
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub name_zh: String,
    #[serde(default = "default_hex")]
    pub hex: String,
    #[serde(default)]
    pub rgb: [u8; 3],
    #[serde(default)]
    pub count: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExportRequest {
    pub pixel_matrix: Vec<Vec<Option<String>>>,
    #[serde(default)]
    pub color_data: HashMap<String, String>,
    #[serde(default)]
    pub color_summary: Vec<ExportColorSummaryEntry>,
    #[serde(default = "default_cell_size")]
    pub cell_size: u32,
    #[serde(default = "default_true")]
    pub show_grid: bool,
    #[serde(default = "default_true")]
    pub show_codes_in_cells: bool,
    #[serde(default = "default_true")]
    pub show_coordinates: bool,
    #[serde(default = "default_palette_preset")]
    pub palette_preset: String,
}

fn default_hex() -> String {
    "#FFFFFF".to_string()
}

fn default_cell_size() -> u32 {
    20
}

fn default_true() -> bool {
    true
}

fn default_palette_preset() -> String {
    "221".to_string()
}

pub fn export_png(request: ExportRequest) -> Result<BinaryExport, ExportError> {
    validate_pixel_matrix(&request.pixel_matrix)?;
    let image = render_pattern_image(&request)?;
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    Ok(BinaryExport {
        content_type: "image/png".to_string(),
        filename: format!("beadcraft_pattern_{timestamp}.png"),
        body: encode_png(&image)?,
    })
}

pub fn export_pdf(request: ExportRequest) -> Result<BinaryExport, ExportError> {
    validate_pixel_matrix(&request.pixel_matrix)?;
    let page1 = render_pdf_pattern_page(&request)?;
    let page2 = render_summary_page_image(&request)?;
    let page_bytes = [encode_png(&page1)?, encode_png(&page2)?];
    let (page_w_mm, page_h_mm) = page_size_mm(&request.pixel_matrix);

    let mut doc = PdfDocument::new("BeadCraft Pattern");
    let mut pages = Vec::new();
    for png_bytes in page_bytes {
        let raw_image =
            RawImage::decode_from_bytes(&png_bytes, &mut Vec::new()).map_err(|err| ExportError::Pdf(err.to_string()))?;
        let image_id = doc.add_image(&raw_image);
        let transform = fit_image_transform(raw_image.width as f32, raw_image.height as f32, page_w_mm, page_h_mm);
        pages.push(PdfPage::new(
            Mm(page_w_mm),
            Mm(page_h_mm),
            vec![Op::UseXobject {
                id: image_id,
                transform,
            }],
        ));
    }

    let bytes = doc
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut Vec::new());
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    Ok(BinaryExport {
        content_type: "application/pdf".to_string(),
        filename: format!("beadcraft_pattern_{timestamp}.pdf"),
        body: bytes,
    })
}

fn fit_image_transform(image_width_px: f32, image_height_px: f32, page_w_mm: f32, page_h_mm: f32) -> XObjectTransform {
    let page_w_pt = mm_to_pt(page_w_mm);
    let page_h_pt = mm_to_pt(page_h_mm);
    let scale = (page_w_pt / image_width_px).min(page_h_pt / image_height_px);
    let rendered_w = image_width_px * scale;
    let rendered_h = image_height_px * scale;
    let translate_x = (page_w_pt - rendered_w) / 2.0;
    let translate_y = (page_h_pt - rendered_h) / 2.0;

    XObjectTransform {
        translate_x: Some(Pt(translate_x)),
        translate_y: Some(Pt(translate_y)),
        rotate: None,
        scale_x: Some(scale),
        scale_y: Some(scale),
        dpi: Some(72.0),
    }
}

fn page_size_mm(pixel_matrix: &[Vec<Option<String>>]) -> (f32, f32) {
    let height = pixel_matrix.len();
    let width = pixel_matrix.first().map(|row| row.len()).unwrap_or(0);
    if width >= height {
        (297.0, 210.0)
    } else {
        (210.0, 297.0)
    }
}

fn render_pdf_pattern_page(request: &ExportRequest) -> Result<RgbImage, ExportError> {
    let (page_w_mm, page_h_mm) = page_size_mm(&request.pixel_matrix);
    let page_w_px = mm_to_px(page_w_mm, 150.0);
    let page_h_px = mm_to_px(page_h_mm, 150.0);
    let mut image = RgbImage::from_pixel(page_w_px, page_h_px, rgb(255, 255, 255));

    let margin = mm_to_px(15.0, 150.0);
    let title_scale = 3;
    let body_scale = 1;
    draw_centered_text(
        &mut image,
        page_w_px as i32 / 2,
        margin as i32,
        "BeadCraft Pattern",
        title_scale,
        rgb(20, 20, 20),
    );
    let subtitle = format!(
        "Generated: {} | Preset: {}",
        Local::now().format("%Y-%m-%d %H:%M:%S"),
        request.palette_preset
    );
    draw_centered_text(
        &mut image,
        page_w_px as i32 / 2,
        margin as i32 + 34,
        &subtitle,
        body_scale,
        rgb(90, 90, 90),
    );

    let grid_h = request.pixel_matrix.len() as u32;
    let grid_w = request.pixel_matrix.first().map(|row| row.len()).unwrap_or(0) as u32;
    let coord_px = if request.show_coordinates { mm_to_px(8.0, 150.0) } else { 0 };
    let available_w = page_w_px.saturating_sub(margin * 2 + coord_px * 2);
    let available_h = page_h_px.saturating_sub(margin * 2 + coord_px * 2 + 80);
    let max_cell = mm_to_px(6.0, 150.0).max(1);
    let cell_size = (available_w / grid_w.max(1))
        .min(available_h / grid_h.max(1))
        .min(max_cell)
        .max(1);

    let pattern_w = grid_w * cell_size;
    let ox = ((page_w_px - pattern_w) / 2) as i32;
    let oy = (margin + 60 + coord_px) as i32;

    render_pattern_cells(
        &mut image,
        request,
        ox,
        oy,
        cell_size,
        request.show_coordinates,
        request.show_grid,
        false,
    );

    Ok(image)
}

fn render_summary_page_image(request: &ExportRequest) -> Result<RgbImage, ExportError> {
    let (page_w_mm, page_h_mm) = page_size_mm(&request.pixel_matrix);
    let page_w_px = mm_to_px(page_w_mm, 150.0);
    let page_h_px = mm_to_px(page_h_mm, 150.0);
    let mut image = RgbImage::from_pixel(page_w_px, page_h_px, rgb(255, 255, 255));
    let margin = mm_to_px(15.0, 150.0) as i32;
    let title_scale = 3;
    let body_scale = 1;
    let heading_scale = 2;

    draw_centered_text(
        &mut image,
        page_w_px as i32 / 2,
        margin,
        "Color Shopping List",
        title_scale,
        rgb(20, 20, 20),
    );
    let subtitle = format!("Generated: {}", Local::now().format("%Y-%m-%d %H:%M:%S"));
    draw_centered_text(
        &mut image,
        page_w_px as i32 / 2,
        margin + 34,
        &subtitle,
        body_scale,
        rgb(90, 90, 90),
    );

    let table_top = margin + 76;
    let col_color = margin;
    let col_code = margin + 100;
    let col_name = margin + 240;
    let col_count = page_w_px as i32 - margin - 120;

    draw_text(&mut image, col_color, table_top, "COLOR", heading_scale, rgb(0, 0, 0));
    draw_text(&mut image, col_code, table_top, "CODE", heading_scale, rgb(0, 0, 0));
    draw_text(&mut image, col_name, table_top, "NAME", heading_scale, rgb(0, 0, 0));
    draw_text(&mut image, col_count, table_top, "COUNT", heading_scale, rgb(0, 0, 0));
    draw_hline(
        &mut image,
        margin as u32,
        (table_top + 24) as u32,
        (page_w_px as i32 - margin) as u32,
        rgb(204, 204, 204),
    );

    let mut y = table_top + 42;
    let row_h = 42;
    let mut total = 0usize;
    for item in &request.color_summary {
        let swatch_color = parse_hex_color(&summary_hex(item));
        fill_rect(&mut image, col_color as u32, y as u32, (col_color + 28) as u32, (y + 28) as u32, swatch_color);
        stroke_rect(
            &mut image,
            col_color as u32,
            y as u32,
            (col_color + 28) as u32,
            (y + 28) as u32,
            rgb(160, 160, 160),
        );
        draw_text(&mut image, col_code, y + 4, &item.code, heading_scale, rgb(0, 0, 0));
        let display_name = if item.name.is_empty() { item.code.clone() } else { item.name.clone() };
        draw_text(&mut image, col_name, y + 4, &display_name, heading_scale, rgb(0, 0, 0));
        draw_text(
            &mut image,
            col_count,
            y + 4,
            &item.count.to_string(),
            heading_scale,
            rgb(0, 0, 0),
        );
        total += item.count;
        y += row_h;

        if y > page_h_px as i32 - margin - 80 {
            break;
        }
    }

    draw_hline(
        &mut image,
        margin as u32,
        (page_h_px as i32 - margin - 40) as u32,
        (page_w_px as i32 - margin) as u32,
        rgb(204, 204, 204),
    );
    let total_line = format!("Total: {} colors, {} beads", request.color_summary.len(), total);
    draw_text(
        &mut image,
        margin,
        page_h_px as i32 - margin - 24,
        &total_line,
        heading_scale,
        rgb(0, 0, 0),
    );
    Ok(image)
}

fn render_pattern_image(request: &ExportRequest) -> Result<RgbImage, ExportError> {
    let grid_h = request.pixel_matrix.len() as u32;
    let grid_w = request.pixel_matrix.first().map(|row| row.len()).unwrap_or(0) as u32;
    let coord_size = if request.show_coordinates { 20 } else { 0 };
    let pattern_w = grid_w * request.cell_size;
    let pattern_h = grid_h * request.cell_size;
    let summary_line_h = 36;
    let colors_per_row = (pattern_w / 90).max(1);
    let summary_rows = ((request.color_summary.len() as u32 + colors_per_row - 1) / colors_per_row).max(1);
    let summary_h = summary_rows * summary_line_h + 28;
    let img_w = coord_size + pattern_w + coord_size;
    let img_h = coord_size + pattern_h + coord_size + 1 + summary_h;

    let mut image = RgbImage::from_pixel(img_w, img_h, rgb(255, 255, 255));
    render_pattern_cells(
        &mut image,
        request,
        coord_size as i32,
        coord_size as i32,
        request.cell_size,
        request.show_coordinates,
        request.show_grid,
        request.show_codes_in_cells,
    );

    let summary_top = coord_size + pattern_h + coord_size + 1;
    draw_hline(&mut image, coord_size, summary_top - 1, coord_size + pattern_w, rgb(200, 200, 200));
    fill_rect(&mut image, 0, summary_top, img_w, img_h, rgb(247, 247, 247));

    let mut sx = coord_size + 4;
    let mut sy = summary_top + 4;
    let mut col_idx = 0u32;
    for item in &request.color_summary {
        let swatch = parse_hex_color(&summary_hex(item));
        fill_rect(&mut image, sx, sy, sx + 20, sy + 20, swatch);
        stroke_rect(&mut image, sx, sy, sx + 20, sy + 20, rgb(180, 180, 180));
        draw_text(&mut image, (sx + 24) as i32, (sy + 2) as i32, &item.code, 1, rgb(30, 30, 30));
        draw_text(
            &mut image,
            (sx + 24) as i32,
            (sy + 14) as i32,
            &item.count.to_string(),
            1,
            rgb(120, 120, 120),
        );
        col_idx += 1;
        sx += 90;
        if col_idx >= colors_per_row {
            col_idx = 0;
            sx = coord_size + 4;
            sy += summary_line_h;
        }
    }

    let total_beads: usize = request.color_summary.iter().map(|item| item.count).sum();
    let total_line = format!(
        "Artkal M [{}]  Total: {} beads, {} colors",
        request.palette_preset, total_beads, request.color_summary.len()
    );
    draw_text(
        &mut image,
        (coord_size + 4) as i32,
        img_h as i32 - 18,
        &total_line,
        1,
        rgb(100, 100, 100),
    );

    Ok(image)
}

fn render_pattern_cells(
    image: &mut RgbImage,
    request: &ExportRequest,
    ox: i32,
    oy: i32,
    cell_size: u32,
    show_coordinates: bool,
    show_grid: bool,
    show_codes_in_cells: bool,
) {
    let grid_h = request.pixel_matrix.len();
    let grid_w = request.pixel_matrix.first().map(|row| row.len()).unwrap_or(0);
    if show_coordinates {
        for x in 0..grid_w {
            let label_top = (x + 1).to_string();
            let label_bottom = (grid_w - x).to_string();
            let cx = ox + x as i32 * cell_size as i32 + cell_size as i32 / 2;
            draw_centered_text(image, cx, oy - 14, &label_top, 1, rgb(136, 136, 136));
            draw_centered_text(
                image,
                cx,
                oy + grid_h as i32 * cell_size as i32 + 10,
                &label_bottom,
                1,
                rgb(136, 136, 136),
            );
        }
        for y in 0..grid_h {
            let label = (y + 1).to_string();
            let cy = oy + y as i32 * cell_size as i32 + cell_size as i32 / 2;
            draw_centered_text(image, ox - 10, cy, &label, 1, rgb(136, 136, 136));
            draw_centered_text(
                image,
                ox + grid_w as i32 * cell_size as i32 + 10,
                cy,
                &label,
                1,
                rgb(136, 136, 136),
            );
        }
    }

    for y in 0..grid_h {
        for x in 0..grid_w {
            let x0 = (ox + x as i32 * cell_size as i32).max(0) as u32;
            let y0 = (oy + y as i32 * cell_size as i32).max(0) as u32;
            let x1 = x0 + cell_size;
            let y1 = y0 + cell_size;
            match request.pixel_matrix[y][x].as_deref() {
                None => draw_checkerboard(image, x0, y0, x1, y1, cell_size),
                Some(code) => {
                    let fill = resolve_color(request, code);
                    fill_rect(image, x0, y0, x1, y1, fill);
                    if show_codes_in_cells && cell_size >= 16 {
                        let text_color = if luminance(fill) > 128 { rgb(0, 0, 0) } else { rgb(255, 255, 255) };
                        draw_centered_text(
                            image,
                            x0 as i32 + cell_size as i32 / 2,
                            y0 as i32 + cell_size as i32 / 2,
                            code,
                            1,
                            text_color,
                        );
                    }
                }
            }
        }
    }

    if show_grid {
        for x in 0..=grid_w {
            let px = (ox + x as i32 * cell_size as i32).max(0) as u32;
            draw_vline(
                image,
                px,
                oy.max(0) as u32,
                (oy + grid_h as i32 * cell_size as i32).max(0) as u32,
                rgb(180, 180, 180),
            );
        }
        for y in 0..=grid_h {
            let py = (oy + y as i32 * cell_size as i32).max(0) as u32;
            draw_hline(
                image,
                ox.max(0) as u32,
                py,
                (ox + grid_w as i32 * cell_size as i32).max(0) as u32,
                rgb(180, 180, 180),
            );
        }
    }
}

fn resolve_color(request: &ExportRequest, code: &str) -> Rgb<u8> {
    if let Some(hex) = request.color_data.get(code) {
        return parse_hex_color(hex);
    }
    if let Some(item) = request.color_summary.iter().find(|item| item.code == code) {
        return parse_hex_color(&summary_hex(item));
    }
    if let Some(color) = global_palette().get_by_code(code) {
        return rgb(color.rgb[0], color.rgb[1], color.rgb[2]);
    }
    rgb(255, 255, 255)
}

fn summary_hex(item: &ExportColorSummaryEntry) -> String {
    if item.hex != "#FFFFFF" || item.rgb == [255, 255, 255] {
        item.hex.clone()
    } else {
        format!("#{:02X}{:02X}{:02X}", item.rgb[0], item.rgb[1], item.rgb[2])
    }
}

fn validate_pixel_matrix(pixel_matrix: &[Vec<Option<String>>]) -> Result<(), ExportError> {
    if pixel_matrix.is_empty() || pixel_matrix.first().map(|row| row.is_empty()).unwrap_or(true) {
        return Err(ExportError::MissingPixelMatrix);
    }
    Ok(())
}

fn encode_png(image: &RgbImage) -> Result<Vec<u8>, ExportError> {
    let mut cursor = Cursor::new(Vec::new());
    let encoder = PngEncoder::new(&mut cursor);
    encoder
        .write_image(image.as_raw(), image.width(), image.height(), ColorType::Rgb8.into())
        .map_err(|err| ExportError::PngEncode(err.to_string()))?;
    Ok(cursor.into_inner())
}

fn draw_checkerboard(image: &mut RgbImage, x0: u32, y0: u32, x1: u32, y1: u32, cell_size: u32) {
    let block = (cell_size / 5).max(2);
    let mut cy = y0;
    while cy < y1 {
        let mut cx = x0;
        while cx < x1 {
            let ix = (cx - x0) / block;
            let iy = (cy - y0) / block;
            let color = if (ix + iy) % 2 == 0 {
                rgb(220, 220, 220)
            } else {
                rgb(180, 180, 180)
            };
            fill_rect(image, cx, cy, (cx + block).min(x1), (cy + block).min(y1), color);
            cx += block;
        }
        cy += block;
    }
}

fn draw_text(image: &mut RgbImage, x: i32, y: i32, text: &str, scale: u32, color: Rgb<u8>) {
    let mut cursor_x = x;
    let scale_i = scale.max(1) as i32;
    for ch in text.chars() {
        if ch == '\n' {
            cursor_x = x;
            continue;
        }
        if let Some(glyph) = BASIC_FONTS.get(ch) {
            for (row, bits) in glyph.iter().enumerate() {
                for col in 0..8 {
                    if bits & (1 << col) == 0 {
                        continue;
                    }
                    let px = cursor_x + col * scale_i;
                    let py = y + row as i32 * scale_i;
                    for sy in 0..scale_i {
                        for sx in 0..scale_i {
                            put_pixel_safe(image, px + sx, py + sy, color);
                        }
                    }
                }
            }
        }
        cursor_x += 8 * scale_i + scale_i;
    }
}

fn draw_centered_text(image: &mut RgbImage, center_x: i32, center_y: i32, text: &str, scale: u32, color: Rgb<u8>) {
    let (width, height) = measure_text(text, scale);
    let x = center_x - width as i32 / 2;
    let y = center_y - height as i32 / 2;
    draw_text(image, x, y, text, scale, color);
}

fn measure_text(text: &str, scale: u32) -> (u32, u32) {
    let scale = scale.max(1);
    let chars = text.chars().count() as u32;
    let width = chars.saturating_mul(8 * scale + scale).saturating_sub(scale);
    let height = 8 * scale;
    (width, height)
}

fn fill_rect(image: &mut RgbImage, x0: u32, y0: u32, x1: u32, y1: u32, color: Rgb<u8>) {
    let max_x = image.width();
    let max_y = image.height();
    for y in y0.min(max_y)..y1.min(max_y) {
        for x in x0.min(max_x)..x1.min(max_x) {
            image.put_pixel(x, y, color);
        }
    }
}

fn stroke_rect(image: &mut RgbImage, x0: u32, y0: u32, x1: u32, y1: u32, color: Rgb<u8>) {
    draw_hline(image, x0, y0, x1, color);
    draw_hline(image, x0, y1.saturating_sub(1), x1, color);
    draw_vline(image, x0, y0, y1, color);
    draw_vline(image, x1.saturating_sub(1), y0, y1, color);
}

fn draw_hline(image: &mut RgbImage, x0: u32, y: u32, x1: u32, color: Rgb<u8>) {
    if y >= image.height() {
        return;
    }
    for x in x0.min(image.width())..x1.min(image.width()) {
        image.put_pixel(x, y, color);
    }
}

fn draw_vline(image: &mut RgbImage, x: u32, y0: u32, y1: u32, color: Rgb<u8>) {
    if x >= image.width() {
        return;
    }
    for y in y0.min(image.height())..y1.min(image.height()) {
        image.put_pixel(x, y, color);
    }
}

fn put_pixel_safe(image: &mut RgbImage, x: i32, y: i32, color: Rgb<u8>) {
    if x < 0 || y < 0 {
        return;
    }
    let (x, y) = (x as u32, y as u32);
    if x < image.width() && y < image.height() {
        image.put_pixel(x, y, color);
    }
}

fn parse_hex_color(hex: &str) -> Rgb<u8> {
    let hex = hex.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return rgb(255, 255, 255);
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(255);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(255);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(255);
    rgb(r, g, b)
}

fn luminance(color: Rgb<u8>) -> u32 {
    (u32::from(color[0]) * 299 + u32::from(color[1]) * 587 + u32::from(color[2]) * 114) / 1000
}

fn rgb(r: u8, g: u8, b: u8) -> Rgb<u8> {
    Rgb([r, g, b])
}

fn mm_to_px(mm: f32, dpi: f32) -> u32 {
    ((mm / 25.4) * dpi).round().max(1.0) as u32
}

fn mm_to_pt(mm: f32) -> f32 {
    (mm / 25.4) * 72.0
}
