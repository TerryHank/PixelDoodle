use std::{
    io::Write,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serialport::{SerialPortInfo, SerialPortType};
use thiserror::Error;

use crate::palette::global_palette;

const MAGIC_HEADER: [u8; 4] = [0xBC, 0xD1, 0x32, 0x57];
const BAUD_RATE: u32 = 460_800;
const IMAGE_SIZE: usize = 8192;
const RGB565_BLACK: u16 = 0x0000;
const TRANSPARENT_RGB565: u16 = 0x0001;

#[derive(Debug, Error)]
pub enum DeviceError {
    #[error("port is required")]
    MissingPort,
    #[error("pixel_matrix is required")]
    MissingPixelMatrix,
    #[error("serial error: {0}")]
    Serial(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct SerialPortEntry {
    pub device: String,
    pub description: String,
    pub hwid: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SerialPortsResponse {
    pub ports: Vec<SerialPortEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BleDeviceEntry {
    pub address: String,
    pub name: String,
    pub device_uuid: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BleDevicesResponse {
    pub devices: Vec<BleDeviceEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SendResponse {
    pub success: bool,
    pub message: String,
    pub bytes_sent: usize,
    pub duration_ms: u128,
    pub grid_size: [usize; 2],
    pub logs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HighlightResponse {
    pub success: bool,
    pub message: String,
    pub duration_ms: u128,
    pub logs: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SerialSendRequest {
    pub pixel_matrix: Vec<Vec<Option<String>>>,
    pub port: String,
    #[serde(default = "default_baud_rate")]
    pub baud_rate: u32,
    #[serde(default)]
    pub background_color: Option<[u8; 3]>,
    #[serde(default = "default_led_matrix_size")]
    pub led_matrix_size: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HighlightRequest {
    pub port: String,
    #[serde(default = "default_baud_rate")]
    pub baud_rate: u32,
    #[serde(default)]
    pub highlight_colors: Vec<[u8; 3]>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BleSendResponse {
    pub success: bool,
    pub message: String,
    pub bytes_sent: usize,
    pub duration_ms: u128,
}

fn default_baud_rate() -> u32 {
    BAUD_RATE
}

fn default_led_matrix_size() -> String {
    "64x64".to_string()
}

pub fn list_serial_ports() -> Result<SerialPortsResponse, DeviceError> {
    let ports = serialport::available_ports()
        .map_err(|err| DeviceError::Serial(err.to_string()))?
        .into_iter()
        .map(map_serial_port_info)
        .collect();
    Ok(SerialPortsResponse { ports })
}

pub fn list_ble_devices() -> BleDevicesResponse {
    BleDevicesResponse {
        devices: Vec::new(),
    }
}

pub fn send_to_serial(request: SerialSendRequest) -> Result<SendResponse, DeviceError> {
    if request.port.trim().is_empty() {
        return Err(DeviceError::MissingPort);
    }
    if request.pixel_matrix.is_empty()
        || request
            .pixel_matrix
            .first()
            .map(|row| row.is_empty())
            .unwrap_or(true)
    {
        return Err(DeviceError::MissingPixelMatrix);
    }

    let start = Instant::now();
    let background = request.background_color.unwrap_or([0, 0, 0]);
    let led_size = parse_led_matrix_size(&request.led_matrix_size);
    let packet = build_packet(&request.pixel_matrix, background, led_size);
    let grid_size = [
        request
            .pixel_matrix
            .first()
            .map(|row| row.len())
            .unwrap_or(0),
        request.pixel_matrix.len(),
    ];

    let mut port = serialport::new(&request.port, request.baud_rate)
        .timeout(Duration::from_millis(200))
        .open()
        .map_err(|err| DeviceError::Serial(err.to_string()))?;
    let _ = port.write_data_terminal_ready(false);
    let _ = port.write_request_to_send(false);

    write_in_chunks(&mut *port, &packet).map_err(|err| DeviceError::Serial(err.to_string()))?;
    let logs = read_logs(&mut *port, Duration::from_secs(3));
    let success = logs.iter().any(|line| line == "OK" || line == "OK_HL");
    let message = logs
        .iter()
        .find(|line| line.starts_with("CS_ERR") || *line == "OK" || *line == "OK_HL")
        .cloned()
        .unwrap_or_else(|| "Data sent successfully".to_string());

    Ok(SendResponse {
        success: success || logs.is_empty(),
        message,
        bytes_sent: packet.len(),
        duration_ms: start.elapsed().as_millis(),
        grid_size,
        logs,
    })
}

pub fn highlight_serial(request: HighlightRequest) -> Result<HighlightResponse, DeviceError> {
    if request.port.trim().is_empty() {
        return Err(DeviceError::MissingPort);
    }
    let start = Instant::now();
    let mut packet = Vec::new();
    if request.highlight_colors.is_empty() {
        packet.push(0x05);
    } else {
        packet.push(0x04);
        packet.push(request.highlight_colors.len().min(u8::MAX as usize) as u8);
        for rgb in request.highlight_colors.iter().take(u8::MAX as usize) {
            packet.extend_from_slice(&rgb_to_rgb565(rgb[0], rgb[1], rgb[2]).to_le_bytes());
        }
    }

    let mut port = serialport::new(&request.port, request.baud_rate)
        .timeout(Duration::from_millis(200))
        .open()
        .map_err(|err| DeviceError::Serial(err.to_string()))?;
    let _ = port.write_data_terminal_ready(false);
    let _ = port.write_request_to_send(false);
    port.write_all(&packet)
        .map_err(|err| DeviceError::Serial(err.to_string()))?;
    port.flush()
        .map_err(|err| DeviceError::Serial(err.to_string()))?;
    let logs = read_logs(&mut *port, Duration::from_secs(1));

    Ok(HighlightResponse {
        success: true,
        message: if request.highlight_colors.is_empty() {
            "Highlight cleared".to_string()
        } else {
            format!("Highlight {} colors", request.highlight_colors.len())
        },
        duration_ms: start.elapsed().as_millis(),
        logs,
    })
}

pub fn send_to_ble_backend() -> BleSendResponse {
    BleSendResponse {
        success: false,
        message: "Rust backend BLE API is unavailable; use Web Bluetooth in the browser"
            .to_string(),
        bytes_sent: 0,
        duration_ms: 0,
    }
}

fn write_in_chunks(port: &mut dyn serialport::SerialPort, packet: &[u8]) -> std::io::Result<()> {
    for chunk in packet.chunks(512) {
        port.write_all(chunk)?;
        port.flush()?;
        std::thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}

fn read_logs(port: &mut dyn serialport::SerialPort, timeout: Duration) -> Vec<String> {
    let start = Instant::now();
    let mut logs = Vec::new();
    let mut buffer = Vec::<u8>::new();
    let mut read_buf = [0u8; 256];

    while start.elapsed() < timeout {
        match port.read(&mut read_buf) {
            Ok(0) => {}
            Ok(count) => {
                buffer.extend_from_slice(&read_buf[..count]);
                while let Some(pos) = buffer.iter().position(|byte| *byte == b'\n') {
                    let line_bytes = buffer.drain(..=pos).collect::<Vec<_>>();
                    let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                    if !line.is_empty() {
                        let stop = line == "OK"
                            || line == "OK_HL"
                            || line.contains("HIGHLIGHT")
                            || line.contains("SHOW_ALL")
                            || line.starts_with("CS_ERR");
                        logs.push(line);
                        if stop {
                            return logs;
                        }
                    }
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => break,
        }
        std::thread::sleep(Duration::from_millis(10));
    }

    logs
}

fn parse_led_matrix_size(raw: &str) -> (usize, usize) {
    let mut parts = raw.split('x');
    let width = parts
        .next()
        .and_then(|part| part.parse::<usize>().ok())
        .unwrap_or(64);
    let height = parts
        .next()
        .and_then(|part| part.parse::<usize>().ok())
        .unwrap_or(64);
    (width, height)
}

fn build_packet(
    pixel_matrix: &[Vec<Option<String>>],
    background_color: [u8; 3],
    led_size: (usize, usize),
) -> Vec<u8> {
    let scaled = scale_and_center_image(pixel_matrix, led_size.0, led_size.1);
    let centered = center_in_bounds(&scaled, 64, 64);
    let mut rgb565 = pixel_matrix_to_rgb565(&centered, background_color);
    if rgb565.len() < IMAGE_SIZE {
        rgb565.resize(IMAGE_SIZE, 0);
    } else if rgb565.len() > IMAGE_SIZE {
        rgb565.truncate(IMAGE_SIZE);
    }
    let checksum = rgb565.iter().fold(0u32, |acc, byte| acc + u32::from(*byte)) as u16;

    let mut packet = Vec::with_capacity(MAGIC_HEADER.len() + rgb565.len() + 2);
    packet.extend_from_slice(&MAGIC_HEADER);
    packet.extend_from_slice(&rgb565);
    packet.extend_from_slice(&checksum.to_le_bytes());
    packet
}

fn pixel_matrix_to_rgb565(
    pixel_matrix: &[Vec<Option<String>>],
    background_color: [u8; 3],
) -> Vec<u8> {
    let background = background_fill_rgb565(background_color);
    let palette = global_palette();
    let mut data = Vec::with_capacity(
        pixel_matrix.len() * pixel_matrix.first().map(|row| row.len()).unwrap_or(0) * 2,
    );
    for row in pixel_matrix {
        for code in row {
            let rgb565 = match code.as_deref() {
                None => background,
                Some(code) => palette
                    .get_by_code(code)
                    .map(|color| rgb_to_rgb565(color.rgb[0], color.rgb[1], color.rgb[2]))
                    .unwrap_or_else(|| rgb_to_rgb565(255, 255, 255)),
            };
            data.extend_from_slice(&rgb565.to_le_bytes());
        }
    }
    data
}

fn scale_and_center_image(
    pixel_matrix: &[Vec<Option<String>>],
    led_width: usize,
    led_height: usize,
) -> Vec<Vec<Option<String>>> {
    if pixel_matrix.is_empty()
        || pixel_matrix
            .first()
            .map(|row| row.is_empty())
            .unwrap_or(true)
    {
        return vec![vec![None; led_width]; led_height];
    }

    let src_height = pixel_matrix.len();
    let src_width = pixel_matrix[0].len();
    let scale = (led_width as f32 / src_width as f32).min(led_height as f32 / src_height as f32);
    let scaled_width = (src_width as f32 * scale).floor().max(1.0) as usize;
    let scaled_height = (src_height as f32 * scale).floor().max(1.0) as usize;
    let offset_x = (led_width - scaled_width) / 2;
    let offset_y = (led_height - scaled_height) / 2;
    let mut result = vec![vec![None; led_width]; led_height];

    for led_y in 0..led_height {
        for led_x in 0..led_width {
            let rel_x = led_x as isize - offset_x as isize;
            let rel_y = led_y as isize - offset_y as isize;
            if rel_x < 0
                || rel_y < 0
                || rel_x as usize >= scaled_width
                || rel_y as usize >= scaled_height
            {
                continue;
            }
            let src_x = ((rel_x as f32) / scale).floor() as usize;
            let src_y = ((rel_y as f32) / scale).floor() as usize;
            let src_x = src_x.min(src_width - 1);
            let src_y = src_y.min(src_height - 1);
            result[led_y][led_x] = pixel_matrix[src_y][src_x].clone();
        }
    }

    result
}

fn center_in_bounds(
    pixel_matrix: &[Vec<Option<String>>],
    target_width: usize,
    target_height: usize,
) -> Vec<Vec<Option<String>>> {
    if pixel_matrix.is_empty()
        || pixel_matrix
            .first()
            .map(|row| row.is_empty())
            .unwrap_or(true)
    {
        return vec![vec![None; target_width]; target_height];
    }

    let src_height = pixel_matrix.len();
    let src_width = pixel_matrix[0].len();
    let offset_x = (target_width - src_width) / 2;
    let offset_y = (target_height - src_height) / 2;
    let mut result = vec![vec![None; target_width]; target_height];

    for y in 0..src_height {
        for x in 0..src_width {
            result[y + offset_y][x + offset_x] = pixel_matrix[y][x].clone();
        }
    }
    result
}

fn background_fill_rgb565(background_color: [u8; 3]) -> u16 {
    let rgb565 = rgb_to_rgb565(
        background_color[0],
        background_color[1],
        background_color[2],
    );
    if rgb565 == RGB565_BLACK {
        TRANSPARENT_RGB565
    } else {
        rgb565
    }
}

fn rgb_to_rgb565(r: u8, g: u8, b: u8) -> u16 {
    let r5 = ((r >> 3) & 0x1f) as u16;
    let g6 = ((g >> 2) & 0x3f) as u16;
    let b5 = ((b >> 3) & 0x1f) as u16;
    (r5 << 11) | (g6 << 5) | b5
}

fn map_serial_port_info(port: SerialPortInfo) -> SerialPortEntry {
    let (description, hwid) = match port.port_type {
        SerialPortType::UsbPort(info) => map_usb_port(info),
        SerialPortType::BluetoothPort => ("Bluetooth Serial".to_string(), "bluetooth".to_string()),
        SerialPortType::PciPort => ("PCI Serial".to_string(), "pci".to_string()),
        SerialPortType::Unknown => (port.port_name.clone(), String::new()),
    };
    SerialPortEntry {
        device: port.port_name,
        description,
        hwid,
    }
}

fn map_usb_port(info: serialport::UsbPortInfo) -> (String, String) {
    let description = info
        .product
        .clone()
        .or(info.manufacturer.clone())
        .unwrap_or_else(|| "USB Serial".to_string());
    let mut hwid = format!("USB VID:PID={:04X}:{:04X}", info.vid, info.pid);
    if let Some(serial) = info.serial_number {
        hwid.push_str(&format!(" SER={serial}"));
    }
    (description, hwid)
}
