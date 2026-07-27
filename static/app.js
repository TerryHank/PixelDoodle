// === BeadCraft Frontend Application ===

// Global state
window.appState = {
  originalImage: null,
  originalImageSize: null,
  pixelMatrix: null,
  colorData: {},
  colorSummary: [],
  fullPalette: {},         // code -> {hex, name, ...} for ALL 221 colors
  fullPaletteList: [],     // ordered array of all colors
  presets: {},             // preset definitions from server
  palettePreset: '221',   // current preset key
  gridSize: { width: 0, height: 0 },
  activeColors: new Set(),
  editMode: false,
  sessionId: null,
  totalBeads: 0,
  targetDeviceUuid: null,
  bleDevice: null,
  bleKnownDevices: [],
  bleServer: null,
  bleCharacteristic: null,
  bleNotifyReady: false,
  isSending: false,        // Lock to prevent concurrent sends
  isGenerating: false,
  lastGenerationMode: null,
  localGenerationWorker: null,
  localGenerationRequests: new Map(),
};

// === Persistent State (localStorage) ===
function savePersistentState() {
  try {
    const data = {
      targetDeviceUuid: window.appState.targetDeviceUuid,
    };
    localStorage.setItem('beadcraft_state', JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save persistent state:', e);
  }
}

const BLE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const BLE_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea0734b3e6c1';
const BLE_IMAGE_SIZE = 8192;
const BLE_CHUNK_SIZE = 19;
const BLE_ACK_TIMEOUT_MS = 5000;
const BLE_SEND_MAX_RETRIES = 3;
const BLE_PACKET_GAP_MS = 8;
const RGB565_BLACK = 0x0000;
const RGB565_TRANSPARENT_MARKER = 0x0001;
const LOCAL_GENERATION_TIMEOUT_MS = 60000;
const LOCAL_GENERATION_WORKER_URL = '/static/local-processing/wasm-worker.js';

let bleAckWaiters = [];

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function getConnectedBleUuid() {
  if (!window.appState.bleDevice?.gatt?.connected) return '';
  return normalizeBleDeviceUuid(window.appState.bleDevice?.name);
}

function rememberConnectedBleTarget() {
  const connectedUuid = getConnectedBleUuid();
  if (!connectedUuid) return '';
  window.appState.targetDeviceUuid = connectedUuid;
  syncTargetUuidToUrl(connectedUuid);
  savePersistentState();
  return connectedUuid;
}

function clearRememberedBleTarget() {
  window.appState.targetDeviceUuid = null;
  syncTargetUuidToUrl('');
  savePersistentState();
}

// === Clear Canvas ===
function clearCanvas() {
  // Reset state
  window.appState.originalImage = null;
  window.appState.originalImageSize = null;
  window.appState.pixelMatrix = null;
  window.appState.colorData = {};
  window.appState.colorSummary = [];
  window.appState.gridSize = { width: 0, height: 0 };
  window.appState.activeColors = new Set();

  // Hide canvas, show upload-area and examples
  document.getElementById('pattern-canvas').style.display = 'none';
  document.getElementById('color-panel').style.display = 'none';
  const uploadArea = document.getElementById('upload-area');
  uploadArea.style.display = '';
  uploadArea.style.removeProperty('display');
  document.getElementById('examples-container').style.display = 'block';

  // Clear canvas
  const canvas = document.getElementById('pattern-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function goHome() {
  clearCanvas();
}

async function setOriginalImageFile(file, dimensions = null) {
  window.appState.originalImage = file;
  window.appState.originalImageSize = dimensions;
}

// === Initialization ===
document.addEventListener('DOMContentLoaded', () => {
  loadFullPalette();
  initUpload();
  applyTranslations();
  updateConnectionModeQuickButton();
  setConnectionMode('ble');
});

function updateConnectionModeQuickButton() {
  const btn = document.getElementById('mode-quick-btn');
  if (!btn) return;
  const connectedUuid = getConnectedBleUuid();
  const shortUuid = connectedUuid ? connectedUuid.slice(0, 4) : '未连接';
  btn.textContent = shortUuid;
  btn.title = connectedUuid ? t('ble.header_connected', {uuid: connectedUuid}) : '未连接蓝牙';
  btn.classList.toggle('connected', !!connectedUuid);
  btn.classList.toggle('disconnected', !connectedUuid);
}

async function cycleConnectionMode() {
  await showSerialSettings();
}

async function handleQuickBleAction() {
  await refreshBLEDevices();
  if (window.appState.bleDevice?.gatt?.connected) {
    await showSerialSettings();
    return;
  }
  if ((window.appState.bleKnownDevices || []).length === 0) {
    await addBLEDevice();
    return;
  }
  await showSerialSettings();
}

// === Load Example Image ===
async function loadExampleImage(name) {
  try {
    // Fetch the original image
    const response = await fetch(`/examples/${name}_original.jpg`);
    if (!response.ok) {
      showToast(t('toast.example_load_error'), true);
      return;
    }

    const blob = await response.blob();
    const file = new File([blob], `${name}_original.jpg`, { type: 'image/jpeg' });

    // Set as original image and generate directly
    await setOriginalImageFile(file);
    document.getElementById('upload-area').style.display = 'none';
    document.getElementById('examples-container').style.display = 'none';
    
    // Generate pattern directly
    await generatePattern();

  } catch (err) {
    showToast(t('toast.example_load_error'), true);
  }
}

async function loadFullPalette() {
  try {
    const resp = await fetch('/api/palette');
    if (resp.ok) {
      const data = await resp.json();
      const colors = data.colors || [];
      window.appState.fullPaletteList = colors;
      colors.forEach(c => {
        window.appState.fullPalette[c.code] = c;
      });
      window.appState.presets = data.presets || {};
    }
  } catch (e) {
    console.error('Failed to load palette', e);
  }
}

// === Toast Notifications ===
function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' error' : '');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function setGenerationLoading(isLoading) {
  const overlay = document.getElementById('generation-loading-overlay');
  const text = document.getElementById('generation-loading-text');
  window.appState.isGenerating = isLoading;
  if (!overlay) return;
  overlay.classList.toggle('visible', isLoading);
  overlay.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
  if (text) {
    text.textContent = t('toast.generating_image');
  }
}

function syncTargetUuidToUrl(uuid) {
  const targetUrl = new URL(window.location.href);
  if (uuid) {
    targetUrl.searchParams.set('u', uuid);
  } else {
    targetUrl.searchParams.delete('u');
  }
  targetUrl.searchParams.delete('device_uuid');
  window.history.replaceState({}, '', targetUrl.toString());
}

function isWebBluetoothAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

function normalizeBleDeviceUuid(name) {
  if (!name || !name.startsWith('BeadCraft-')) return '';
  return name.slice('BeadCraft-'.length).trim().toUpperCase();
}

function getBleDeviceKey(device) {
  if (!device) return '';
  return device.id || normalizeBleDeviceUuid(device.name) || device.name || '';
}

function mergeKnownBleDevices(devices = []) {
  const merged = new Map();
  [...devices, window.appState.bleDevice].filter(Boolean).forEach((device) => {
    const key = getBleDeviceKey(device);
    if (!key || merged.has(key)) return;
    merged.set(key, device);
  });
  return Array.from(merged.values());
}

async function getAuthorizedBLEDevices() {
  if (!isWebBluetoothAvailable()) return [];

  let devices = [];
  if (typeof navigator.bluetooth.getDevices === 'function') {
    try {
      devices = await navigator.bluetooth.getDevices();
    } catch (err) {
      console.warn('Failed to load authorized Bluetooth devices:', err);
    }
  }

  return mergeKnownBleDevices(
    devices.filter((device) => device?.name?.startsWith('BeadCraft-'))
  );
}

function renderBleDeviceList() {
  const list = document.getElementById('ble-device-list');
  const addBtn = document.getElementById('ble-add-device-btn');
  if (!list) return;

  const connectedUuid = getConnectedBleUuid();
  const targetUuid = (window.appState.targetDeviceUuid || '').trim().toUpperCase();
  const currentKey = getBleDeviceKey(window.appState.bleDevice);
  const devices = [...(window.appState.bleKnownDevices || [])];
  const hasRememberedRow = !!targetUuid && devices.some((device) => normalizeBleDeviceUuid(device.name) === targetUuid);

  list.innerHTML = '';

  if (addBtn) {
    addBtn.textContent = t('ble.add_device');
    addBtn.disabled = !isWebBluetoothAvailable();
  }

  if (!isWebBluetoothAvailable()) {
    const unavailable = document.createElement('div');
    unavailable.className = 'ble-device-empty';
    unavailable.textContent = t('ble.bluetooth_unavailable');
    list.appendChild(unavailable);
    return;
  }

  if (!devices.length && !targetUuid) {
    const empty = document.createElement('div');
    empty.className = 'ble-device-empty';
    empty.textContent = t('ble.no_device_hint');
    list.appendChild(empty);
    return;
  }

  devices.forEach((device) => {
    const deviceKey = getBleDeviceKey(device);
    const deviceUuid = normalizeBleDeviceUuid(device.name);
    const isConnected = !!currentKey && currentKey === deviceKey && !!window.appState.bleDevice?.gatt?.connected;
    const isRemembered = !!deviceUuid && deviceUuid === targetUuid;

    const row = document.createElement('button');
    row.type = 'button';
    row.className = `ble-device-option${isConnected ? ' connected' : ''}${isRemembered ? ' remembered' : ''}`;
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', isConnected ? 'true' : 'false');
    row.dataset.deviceKey = deviceKey;
    row.addEventListener('click', () => {
      connectKnownBLEDevice(deviceKey);
    });

    const radio = document.createElement('span');
    radio.className = 'ble-device-radio';
    row.appendChild(radio);

    const info = document.createElement('span');
    info.className = 'ble-device-info';

    const title = document.createElement('span');
    title.className = 'ble-device-title';
    title.textContent = deviceUuid || device.name || 'BeadCraft';
    info.appendChild(title);

    const meta = document.createElement('span');
    meta.className = 'ble-device-meta';
    if (isConnected && (connectedUuid || deviceUuid)) {
      meta.textContent = t('ble.device_connected', {uuid: connectedUuid || deviceUuid});
    } else if (isRemembered && deviceUuid) {
      meta.textContent = t('ble.saved_device', {uuid: deviceUuid});
    } else {
      meta.textContent = t('ble.authorized_device');
    }
    info.appendChild(meta);

    row.appendChild(info);
    list.appendChild(row);
  });

  if (targetUuid && !hasRememberedRow) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ble-device-option remembered';
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', 'false');
    row.addEventListener('click', () => {
      addBLEDevice();
    });

    const radio = document.createElement('span');
    radio.className = 'ble-device-radio';
    row.appendChild(radio);

    const info = document.createElement('span');
    info.className = 'ble-device-info';

    const title = document.createElement('span');
    title.className = 'ble-device-title';
    title.textContent = targetUuid;
    info.appendChild(title);

    const meta = document.createElement('span');
    meta.className = 'ble-device-meta';
    meta.textContent = t('ble.remembered_device_needs_pair', {uuid: targetUuid});
    info.appendChild(meta);

    row.appendChild(info);
    list.appendChild(row);
  }
}

function resetBleTransportState() {
  if (window.appState.bleCharacteristic) {
    window.appState.bleCharacteristic.removeEventListener('characteristicvaluechanged', handleBLENotification);
  }
  window.appState.bleServer = null;
  window.appState.bleCharacteristic = null;
  window.appState.bleNotifyReady = false;
  bleAckWaiters = [];
}

function setActiveBleDevice(device) {
  if (!device) return;
  if (window.appState.bleDevice && getBleDeviceKey(window.appState.bleDevice) !== getBleDeviceKey(device)) {
    const previousDevice = window.appState.bleDevice;
    previousDevice.removeEventListener('gattserverdisconnected', onBLEDisconnected);
    if (previousDevice.gatt?.connected) {
      try {
        previousDevice.gatt.disconnect();
      } catch (err) {
        console.warn('Failed to disconnect previous Bluetooth device:', err);
      }
    }
    resetBleTransportState();
  }
  window.appState.bleDevice = device;
  window.appState.bleKnownDevices = mergeKnownBleDevices(window.appState.bleKnownDevices);
  device.removeEventListener('gattserverdisconnected', onBLEDisconnected);
  device.addEventListener('gattserverdisconnected', onBLEDisconnected);
}

function renderBleStatus() {
  const card = document.getElementById('ble-status-card');
  const uploadArea = document.getElementById('upload-area');
  const targetUuid = (window.appState.targetDeviceUuid || '').trim().toUpperCase();
  const connectedUuid = getConnectedBleUuid();
  const isConnected = !!connectedUuid;
  const knownCount = (window.appState.bleKnownDevices || []).length;

  if (uploadArea) {
    uploadArea.className = 'upload-area';
    uploadArea.innerHTML = `
      <div class="upload-area-icon">+</div>
      <div class="upload-area-text">${t('upload.click_hint')}</div>
      <div class="upload-area-hint">${t('upload.format_hint')}</div>
    `;
  }

  if (card) {
    if (isConnected && connectedUuid) {
      card.style.display = 'block';
      card.className = 'ble-status-card connected';
      card.textContent = t('ble.device_connected', {uuid: connectedUuid});
    } else if (!isWebBluetoothAvailable()) {
      card.style.display = 'block';
      card.className = 'ble-status-card';
      card.textContent = t('ble.bluetooth_unavailable');
    } else if (knownCount > 0) {
      card.style.display = 'block';
      card.className = 'ble-status-card ready';
      card.textContent = t('ble.authorized_list_hint', {count: knownCount});
    } else if (targetUuid) {
      card.style.display = 'block';
      card.className = 'ble-status-card ready';
      card.textContent = t('ble.saved_device_hint', {uuid: targetUuid});
    } else {
      card.style.display = 'block';
      card.className = 'ble-status-card';
      card.textContent = t('ble.no_device_hint');
    }
  }

  updateConnectionModeQuickButton();
}

function onBLEDisconnected() {
  resetBleTransportState();
  clearRememberedBleTarget();
  refreshBLEDevices();
  renderBleStatus();
  showToast(t('toast.ble_disconnected'), true);
}

function handleBLENotification(event) {
  const dataView = event.target?.value;
  if (!dataView || dataView.byteLength < 1) return;
  const code = dataView.getUint8(0);
  console.log('[BLE][notify]', code, String.fromCharCode(code));
  if (code === 0x06 || code === 0x15) {
    const waiter = bleAckWaiters.shift();
    if (waiter) {
      waiter.resolve(code);
    }
    return;
  }
}

function waitForBLEAck(timeoutMs = BLE_ACK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = bleAckWaiters.findIndex(item => item.resolve === resolve);
      if (idx >= 0) bleAckWaiters.splice(idx, 1);
      reject(new Error('BLE ACK timeout'));
    }, timeoutMs);

    bleAckWaiters.push({
      resolve: (code) => {
        clearTimeout(timer);
        resolve(code);
      },
    });
  });
}

function checksum16(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    sum = (sum + bytes[i]) & 0xffff;
  }
  return sum;
}

async function requestBLEDevice(forcePicker = false) {
  if (!isWebBluetoothAvailable()) {
    throw new Error('This browser does not support Web Bluetooth');
  }

  const targetUuid = window.appState.targetDeviceUuid;
  if (!forcePicker && hasMatchingConnectedBLEDevice(targetUuid)) {
    renderBleDeviceList();
    renderBleStatus();
    return window.appState.bleDevice;
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'BeadCraft-' }],
    optionalServices: [BLE_SERVICE_UUID],
  });

  setActiveBleDevice(device);
  await refreshBLEDevices();
  renderBleStatus();
  return device;
}

function hasMatchingConnectedBLEDevice(targetUuid = window.appState.targetDeviceUuid) {
  const device = window.appState.bleDevice;
  if (!device?.gatt?.connected) return false;
  const deviceUuid = normalizeBleDeviceUuid(device.name);
  if (!targetUuid) return true;
  return deviceUuid === targetUuid;
}

async function ensureBLECharacteristic(requestIfNeeded = false) {
  if (!window.appState.bleDevice) {
    if (!requestIfNeeded) {
      throw new Error('No Bluetooth device selected');
    }
    await requestBLEDevice();
  }

  if (!window.appState.bleDevice?.gatt) {
    throw new Error('Selected Bluetooth device does not expose GATT');
  }

  if (window.appState.bleCharacteristic && window.appState.bleDevice.gatt.connected) {
    return window.appState.bleCharacteristic;
  }

  const server = await window.appState.bleDevice.gatt.connect();
  const service = await server.getPrimaryService(BLE_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);
  if (!window.appState.bleNotifyReady) {
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', handleBLENotification);
    window.appState.bleNotifyReady = true;
  }

  window.appState.bleServer = server;
  window.appState.bleCharacteristic = characteristic;

  rememberConnectedBleTarget();
  renderBleDeviceList();
  renderBleStatus();

  return characteristic;
}

async function writeBLEPacket(characteristic, bytes) {
  if (characteristic.writeValueWithoutResponse) {
    await characteristic.writeValueWithoutResponse(bytes);
  } else {
    await characteristic.writeValue(bytes);
  }
  if (BLE_PACKET_GAP_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, BLE_PACKET_GAP_MS));
  }
}

function rgbToRgb565(r, g, b) {
  const r5 = (r >> 3) & 0x1f;
  const g6 = (g >> 2) & 0x3f;
  const b5 = (b >> 3) & 0x1f;
  return (r5 << 11) | (g6 << 5) | b5;
}

function pixelMatrixToRgb565Bytes(pixelMatrix, backgroundColor) {
  const data = new Uint8Array(BLE_IMAGE_SIZE);
  let offset = 0;
  const backgroundColorRgb565 = rgbToRgb565(backgroundColor[0], backgroundColor[1], backgroundColor[2]);
  const backgroundFillRgb565 = backgroundColorRgb565 === RGB565_BLACK ? RGB565_TRANSPARENT_MARKER : backgroundColorRgb565;

  for (const row of pixelMatrix) {
    for (const code of row) {
      let rgb565 = backgroundFillRgb565;
      if (code === null) {
        rgb565 = backgroundFillRgb565;
      } else {
        const colorInfo = window.appState.fullPalette[code] || window.appState.colorData[code];
        if (colorInfo && colorInfo.rgb) {
          rgb565 = rgbToRgb565(colorInfo.rgb[0], colorInfo.rgb[1], colorInfo.rgb[2]);
        } else {
          rgb565 = rgbToRgb565(255, 255, 255);
        }
      }

      data[offset++] = rgb565 & 0xff;
      data[offset++] = (rgb565 >> 8) & 0xff;
      if (offset >= BLE_IMAGE_SIZE) {
        return data;
      }
    }
  }

  return data;
}

function resamplePixelMatrix(pixelMatrix, targetSize) {
  if (!pixelMatrix || !pixelMatrix.length || !pixelMatrix[0]?.length) return pixelMatrix;
  const srcH = pixelMatrix.length;
  const srcW = pixelMatrix[0].length;
  if (srcW === targetSize && srcH === targetSize) return pixelMatrix;

  const out = new Array(targetSize);
  for (let y = 0; y < targetSize; y++) {
    const srcY = Math.min(srcH - 1, Math.floor((y * srcH) / targetSize));
    const row = new Array(targetSize);
    for (let x = 0; x < targetSize; x++) {
      const srcX = Math.min(srcW - 1, Math.floor((x * srcW) / targetSize));
      row[x] = pixelMatrix[srcY][srcX];
    }
    out[y] = row;
  }
  return out;
}

function centerInBounds(pixelMatrix, targetWidth, targetHeight) {
  if (!pixelMatrix || !pixelMatrix.length || !pixelMatrix[0]?.length) {
    return Array(targetHeight).fill(null).map(() => Array(targetWidth).fill(null));
  }
  const srcH = pixelMatrix.length;
  const srcW = pixelMatrix[0].length;
  
  // Create output filled with null (black)
  const result = Array(targetHeight).fill(null).map(() => Array(targetWidth).fill(null));
  
  // Center the image
  const offsetX = Math.floor((targetWidth - srcW) / 2);
  const offsetY = Math.floor((targetHeight - srcH) / 2);
  
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      result[y + offsetY][x + offsetX] = pixelMatrix[y][x];
    }
  }
  return result;
}

function scaleAndCenterImage(pixelMatrix, ledSize) {
  // Step 1: Scale image to fit within LED bounds
  const scaled = resamplePixelMatrix(pixelMatrix, ledSize);
  // Step 2: Center in 64x64 canvas
  return centerInBounds(scaled, 64, 64);
}

function getTargetLedSize() {
  const value = parseInt(document.getElementById('led-matrix-size')?.value, 10);
  if (Number.isFinite(value) && value > 0) return value;
  return 64;
}

async function sendImageViaWebBluetooth(pixelMatrix, backgroundColor, requestIfNeeded = false) {
  const characteristic = await ensureBLECharacteristic(requestIfNeeded);
  const targetSize = getTargetLedSize();
  // Scale to LED size, then center in 64x64 canvas
  const mappedMatrix = scaleAndCenterImage(pixelMatrix, targetSize);
  const rgb565Data = pixelMatrixToRgb565Bytes(mappedMatrix, backgroundColor);
  const start = performance.now();
  const frameChecksum = checksum16(rgb565Data);
  let bytesSent = 0;
  let lastError = null;

  for (let attempt = 1; attempt <= BLE_SEND_MAX_RETRIES; attempt++) {
    bleAckWaiters = [];
    bytesSent = 0;
    try {
      await writeBLEPacket(characteristic, new Uint8Array([0x01]));

      for (let i = 0; i < rgb565Data.length; i += BLE_CHUNK_SIZE) {
        const chunk = rgb565Data.slice(i, i + BLE_CHUNK_SIZE);
        const packet = new Uint8Array(chunk.length + 1);
        packet[0] = 0x02;
        packet.set(chunk, 1);
        await writeBLEPacket(characteristic, packet);
        bytesSent += chunk.length;
      }

      const endPacket = new Uint8Array([0x03, frameChecksum & 0xff, (frameChecksum >> 8) & 0xff]);
      await writeBLEPacket(characteristic, endPacket);
      const ack = await waitForBLEAck();
      if (ack === 0x06) {
        return {
          success: true,
          bytes_sent: bytesSent,
          duration_ms: Math.round(performance.now() - start),
          retries: attempt - 1,
        };
      }
      lastError = new Error('BLE NAK');
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`BLE send failed after retries: ${lastError?.message || 'unknown error'}`);
}

async function sendHighlightViaWebBluetooth(highlightRGB) {
  if (!window.appState.bleDevice) {
    return;
  }

  const characteristic = await ensureBLECharacteristic(false);
  if (highlightRGB.length === 0) {
    await writeBLEPacket(characteristic, new Uint8Array([0x05]));
    return;
  }

  const packet = new Uint8Array(2 + highlightRGB.length * 2);
  packet[0] = 0x04;
  packet[1] = highlightRGB.length;

  highlightRGB.forEach((rgb, index) => {
    const rgb565 = rgbToRgb565(rgb[0], rgb[1], rgb[2]);
    const base = 2 + index * 2;
    packet[base] = rgb565 & 0xff;
    packet[base + 1] = (rgb565 >> 8) & 0xff;
  });

  await writeBLEPacket(characteristic, packet);
}

// === File Upload ===
function initUpload() {
  const input = document.getElementById('file-input');

  input.addEventListener('change', () => {
    if (input.files.length > 0) {
      const file = input.files[0];
      input.value = '';  // Reset so user can select same file again
      handleFile(file);
    }
  });
}

function handleFile(file) {
  // Validate type
  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    showToast(t('toast.upload_type_error'), true);
    return;
  }

  // Validate size (20MB)
  if (file.size > 20 * 1024 * 1024) {
    showToast(t('toast.upload_size_error'), true);
    return;
  }

  // Show crop dialog
  showCropDialog(file);
}

// === Image Crop ===
let cropState = {
  file: null,
  img: null,
  scale: 1,
  box: { x: 0, y: 0, size: 0 },
  dragging: false,
  startX: 0,
  startY: 0,
};

function showCropDialog(file) {
  cropState.file = file;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      cropState.img = img;
      
      const cropImg = document.getElementById('crop-image');
      cropImg.src = e.target.result;
      
      // Calculate display scale
      const container = document.getElementById('crop-container');
      const maxW = window.innerWidth * 0.85;
      const maxH = window.innerHeight * 0.65;
      cropState.scale = Math.min(maxW / img.width, maxH / img.height, 1);
      
      cropImg.style.width = (img.width * cropState.scale) + 'px';
      cropImg.style.height = (img.height * cropState.scale) + 'px';
      
      // Initialize crop box (square based on min dimension)
      const minDim = Math.min(img.width, img.height);
      cropState.box.size = minDim;
      cropState.box.x = (img.width - minDim) / 2;
      cropState.box.y = (img.height - minDim) / 2;
      
      updateCropBox();
      
      // Show dialog
      document.getElementById('crop-dialog').style.display = 'flex';
      
      // Setup drag
      setupCropDrag();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function updateCropBox() {
  const box = document.getElementById('crop-box');
  const scale = cropState.scale;
  box.style.left = (cropState.box.x * scale) + 'px';
  box.style.top = (cropState.box.y * scale) + 'px';
  box.style.width = (cropState.box.size * scale) + 'px';
  box.style.height = (cropState.box.size * scale) + 'px';
}

function setupCropDrag() {
  const box = document.getElementById('crop-box');
  
  // Mouse events
  box.onmousedown = (e) => {
    e.preventDefault();
    cropState.dragging = true;
    cropState.startX = e.clientX - cropState.box.x * cropState.scale;
    cropState.startY = e.clientY - cropState.box.y * cropState.scale;
  };
  
  document.onmousemove = (e) => {
    if (!cropState.dragging) return;
    
    let newX = (e.clientX - cropState.startX) / cropState.scale;
    let newY = (e.clientY - cropState.startY) / cropState.scale;
    
    // Clamp to image bounds
    const img = cropState.img;
    const size = cropState.box.size;
    newX = Math.max(0, Math.min(newX, img.width - size));
    newY = Math.max(0, Math.min(newY, img.height - size));
    
    cropState.box.x = newX;
    cropState.box.y = newY;
    updateCropBox();
  };
  
  document.onmouseup = () => {
    cropState.dragging = false;
  };
  
  // Touch events for mobile
  box.ontouchstart = (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    cropState.dragging = true;
    cropState.startX = touch.clientX - cropState.box.x * cropState.scale;
    cropState.startY = touch.clientY - cropState.box.y * cropState.scale;
  };
  
  document.ontouchmove = (e) => {
    if (!cropState.dragging) return;
    const touch = e.touches[0];
    
    let newX = (touch.clientX - cropState.startX) / cropState.scale;
    let newY = (touch.clientY - cropState.startY) / cropState.scale;
    
    // Clamp to image bounds
    const img = cropState.img;
    const size = cropState.box.size;
    newX = Math.max(0, Math.min(newX, img.width - size));
    newY = Math.max(0, Math.min(newY, img.height - size));
    
    cropState.box.x = newX;
    cropState.box.y = newY;
    updateCropBox();
  };
  
  document.ontouchend = () => {
    cropState.dragging = false;
  };
}

function cancelCrop() {
  document.getElementById('crop-dialog').style.display = 'none';
  cropState = { file: null, img: null, scale: 1, box: { x: 0, y: 0, size: 0 }, dragging: false };
}

function confirmCrop() {
  const img = cropState.img;
  const box = cropState.box;
  
  // Create canvas and crop
  const canvas = document.createElement('canvas');
  canvas.width = box.size;
  canvas.height = box.size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, box.x, box.y, box.size, box.size, 0, 0, box.size, box.size);
  
  // Convert to blob
  canvas.toBlob(async (blob) => {
    const croppedFile = new File([blob], cropState.file.name, { type: 'image/jpeg' });
    await setOriginalImageFile(croppedFile, { width: box.size, height: box.size });
    
    // Close dialog
    cancelCrop();
    
    // Hide upload-area and examples, generate directly
    document.getElementById('upload-area').style.display = 'none';
    document.getElementById('examples-container').style.display = 'none';
    
    // Generate pattern directly
    generatePattern();
  }, 'image/jpeg', 0.95);
}

// === Custom Size Panel ===
function onDifficultyChange() {
  const difficultySelect = document.getElementById('difficulty-select');
  const customSlider = document.getElementById('custom-slider-container');
  
  if (difficultySelect.value === 'custom') {
    customSlider.style.display = 'flex';
  } else {
    customSlider.style.display = 'none';
    // Auto-generate when difficulty changes
    if (window.appState.originalImage) {
      generatePattern();
    }
  }
}

function updateCustomPixelValue() {
  const slider = document.getElementById('custom-pixel-slider');
  const valueSpan = document.getElementById('custom-pixel-value');
  if (slider && valueSpan) {
    const value = slider.value;
    valueSpan.textContent = value;
    // Position value above slider thumb
    const percent = (value - slider.min) / (slider.max - slider.min);
    const sliderWidth = slider.offsetWidth;
    const thumbOffset = percent * sliderWidth;
    valueSpan.style.left = thumbOffset + 'px';
  }
}

function onCustomSliderRelease() {
  if (window.appState.originalImage) {
    generatePattern();
  }
}

function updateLedSizeDisplay() {
  if (window.appState.originalImage) {
    generatePattern();
  }
}

function collectGenerateOptions() {
  const difficultySelect = document.getElementById('difficulty-select');
  const options = {
    mode: 'fixed_grid',
    grid_width: 48,
    grid_height: 48,
    led_size: 64,
    pixel_size: 8,
    use_dithering: false,
    palette_preset: window.appState.palettePreset,
    max_colors: 0,
    similarity_threshold: 0,
    remove_bg: backgroundRemovalEnabled,
    contrast: 0,
    saturation: 0,
    sharpness: 0,
  };

  if (difficultySelect.value === 'custom') {
    options.mode = 'pixel_size';
    options.pixel_size = parseInt(document.getElementById('custom-pixel-slider')?.value) || 8;
  } else {
    const scale = parseFloat(difficultySelect.value) || 0.125;
    const img = window.appState.originalImage;
    const imgWidth = img?.width || img?.naturalWidth || 512;
    const imgHeight = img?.height || img?.naturalHeight || 512;
    const gridWidth = Math.max(16, Math.round(imgWidth * scale));
    const gridHeight = Math.max(16, Math.round(imgHeight * scale));
    options.grid_width = gridWidth;
    options.grid_height = gridHeight;
  }

  options.led_size = parseInt(document.getElementById('led-matrix-size').value) || 64;
  options.use_dithering = document.getElementById('dithering-checkbox')?.checked || false;
  options.palette_preset = window.appState.palettePreset;

  const maxColorsSlider = document.getElementById('max-colors-slider');
  options.max_colors = maxColorsSlider ? parseInt(maxColorsSlider.value) : 0;

  const simSlider = document.getElementById('similarity-slider');
  options.similarity_threshold = simSlider ? parseInt(simSlider.value) : 0;
  options.remove_bg = backgroundRemovalEnabled;

  options.contrast = Number(document.getElementById('contrast-slider')?.value || 0);
  options.saturation = Number(document.getElementById('saturation-slider')?.value || 0);
  options.sharpness = Number(document.getElementById('sharpness-slider')?.value || 0);

  return options;
}

function buildGenerateFormData(options) {
  const formData = new FormData();
  formData.append('file', window.appState.originalImage);
  Object.entries(options).forEach(([key, value]) => {
    formData.append(key, String(value));
  });
  return formData;
}

function normalizeGridSize(gridSize) {
  return {
    height: Number(gridSize?.height ?? 0),
    width: Number(gridSize?.width ?? 0),
  };
}

function normalizePixelMatrixNulls(pixelMatrix) {
  return (pixelMatrix || []).map((row) => (row || []).map((cell) => cell ?? null));
}

function normalizeColorSummary(colorSummary) {
  return (colorSummary || []).map((entry) => ({
    code: entry?.code ?? '',
    count: Number(entry?.count ?? 0),
    hex: entry?.hex ?? '',
    name: entry?.name ?? '',
    name_zh: entry?.name_zh ?? '',
    rgb: Array.isArray(entry?.rgb) ? entry.rgb : [0, 0, 0],
  }));
}

function applyGeneratedPattern(data) {
  const normalizedGridSize = normalizeGridSize(data.grid_size);
  const normalizedColorSummary = normalizeColorSummary(data.color_summary);

  window.appState.sessionId = data.session_id || createSessionId();
  window.appState.pixelMatrix = normalizePixelMatrixNulls(data.pixel_matrix);
  window.appState.gridSize = normalizedGridSize;
  window.appState.colorSummary = normalizedColorSummary;
  window.appState.totalBeads = data.total_beads;
  window.appState.activeColors = new Set();
  window.appState.editMode = false;
  window.appState.palettePreset = data.palette_preset || window.appState.palettePreset || '221';

  window.appState.colorData = {};
  normalizedColorSummary.forEach(c => {
    window.appState.colorData[c.code] = c;
  });

  document.getElementById('upload-area').style.display = 'none';
  document.getElementById('pattern-canvas').style.display = 'block';
  document.getElementById('color-panel').style.display = 'block';
  renderCanvas();
  renderColorPanel();
}

function isLocalGenerationAvailable() {
  return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

function ensureLocalGenerationWorker() {
  if (!isLocalGenerationAvailable()) {
    throw new Error('Local generation is unavailable');
  }

  if (window.appState.localGenerationWorker) {
    return window.appState.localGenerationWorker;
  }

  const worker = new Worker(LOCAL_GENERATION_WORKER_URL, { type: 'module' });
  worker.addEventListener('message', (event) => {
    const { id, ok, result, error } = event.data || {};
    const pending = window.appState.localGenerationRequests.get(id);
    if (!pending) return;
    window.appState.localGenerationRequests.delete(id);
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    if (!ok) {
      pending.reject(new Error(error || 'Local generation failed'));
      return;
    }
    pending.resolve(result);
  });
  worker.addEventListener('error', (event) => {
    console.error('Local generation worker crashed:', event);
  });
  window.appState.localGenerationWorker = worker;
  return worker;
}

async function generatePatternLocally(options) {
  const worker = ensureLocalGenerationWorker();
  const bytes = await window.appState.originalImage.arrayBuffer();
  const requestId = createSessionId();
  return await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      window.appState.localGenerationRequests.delete(requestId);
      reject(new Error('Local generation timed out'));
    }, LOCAL_GENERATION_TIMEOUT_MS);

    window.appState.localGenerationRequests.set(requestId, { resolve, reject, timeoutId });
    worker.postMessage({
      id: requestId,
      bytes,
      options,
    }, [bytes]);
  });
}

async function generatePatternViaServer(options) {
  const formData = buildGenerateFormData(options);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_GENERATION_TIMEOUT_MS);

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Generation failed');
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runPatternGeneration(options) {
  if (isLocalGenerationAvailable()) {
    try {
      const localResult = await generatePatternLocally(options);
      window.appState.lastGenerationMode = 'local-wasm';
      return {
        ...localResult,
        session_id: createSessionId(),
        palette_preset: options.palette_preset,
      };
    } catch (err) {
      console.warn('Local generation failed, falling back to server:', err);
    }
  }

  window.appState.lastGenerationMode = 'server-http';
  return await generatePatternViaServer(options);
}

// === Generate Pattern ===
async function generatePattern() {
  if (!window.appState.originalImage) {
    showToast(t('toast.upload_first'), true);
    return;
  }
  if (window.appState.isGenerating) {
    return;
  }

  const options = collectGenerateOptions();

  try {
    setGenerationLoading(true);
    const data = await runPatternGeneration(options);
    applyGeneratedPattern(data);

    showToast(t('toast.pattern_result', { w: data.grid_size.width, h: data.grid_size.height, c: data.color_summary.length }));

    // Auto-send to ESP32 via serial
    await autoSendToESP32();

  } catch (err) {
    if (err.name === 'AbortError') {
      showToast(t('toast.timeout'), true);
    } else {
      showToast(err.message, true);
    }
  } finally {
    setGenerationLoading(false);
  }
}

async function postJsonOrThrow(url, payload, fallbackMessage) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.detail || result.message || fallbackMessage);
  }
  if (!result.success && (result.message || fallbackMessage)) {
    throw new Error(result.message || fallbackMessage);
  }
  return result;
}

async function sendMatrixViaCurrentMode(pixelMatrix, bgRgb, requestIfNeeded = true) {
  return await sendImageViaWebBluetooth(pixelMatrix, bgRgb, requestIfNeeded);
}

// === Auto Send to ESP32 after generation ===
async function autoSendToESP32() {
  const { pixelMatrix, isSending } = window.appState;
  if (!pixelMatrix) return;
  if (isSending) {
    console.log('[ESP32] Send already in progress, skipping');
    return;
  }
  if (!window.appState.bleDevice?.gatt?.connected) {
    return;
  }
  window.appState.isSending = true;
  const bgRgb = [0, 0, 0];

  // Show toast
  const toast = document.getElementById('serial-toast');
  if (toast) {
    toast.textContent = 'Sending via Bluetooth...';
    toast.className = 'serial-toast';
    toast.style.display = 'block';
  }

  try {
    const result = await sendMatrixViaCurrentMode(pixelMatrix, bgRgb, false);

    if (result.success) {
      if (toast) {
        toast.textContent = `Sent ${result.bytes_sent} bytes in ${result.duration_ms}ms`;
        toast.className = 'serial-toast success';
      }
      showToast('Image sent via Bluetooth!');
    } else {
      if (toast) {
        toast.textContent = result.message;
        toast.className = 'serial-toast error';
      }
    }

    // Hide toast after 3s
    setTimeout(() => {
      if (toast) toast.style.display = 'none';
    }, 3000);

  } catch (err) {
    if (toast) {
      toast.textContent = err.message;
      toast.className = 'serial-toast error';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 3000);
    }
  } finally {
    window.appState.isSending = false;
  }
}

// === Canvas Rendering ===
function renderCanvas() {
  const canvas = document.getElementById('pattern-canvas');
  if (!canvas || !window.appState.pixelMatrix) return;

  const { pixelMatrix, gridSize, activeColors, colorData } = window.appState;
  const ctx = canvas.getContext('2d');

  // Calculate cell size to fit in 640x640
  const maxPatternDim = 640;
  const cellSize = Math.min(
    Math.floor(maxPatternDim / gridSize.width),
    Math.floor(maxPatternDim / gridSize.height)
  );
  const cs = Math.max(cellSize, 2);

  const patternW = gridSize.width * cs;
  const patternH = gridSize.height * cs;

  canvas.width = patternW;
  canvas.height = patternH;

  // Store layout info for click handling
  canvas._cellSize = cs;
  canvas._coordSize = 0;

  // Clear
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const ox = 0;
  const oy = 0;

  // --- Draw cells ---
  const showCodes = false;  // Disabled: don't show color codes on canvas

  for (let y = 0; y < gridSize.height; y++) {
    for (let x = 0; x < gridSize.width; x++) {
      const code = pixelMatrix[y][x];
      const cx = ox + x * cs;
      const cy = oy + y * cs;

      if (code === null) {
        // Transparent: checkerboard
        const bk = Math.max(2, Math.floor(cs / 4));
        for (let by = 0; by < cs; by += bk) {
          for (let bx = 0; bx < cs; bx += bk) {
            const ix = Math.floor(bx / bk);
            const iy = Math.floor(by / bk);
            ctx.fillStyle = (ix + iy) % 2 === 0 ? '#DCDCDC' : '#B4B4B4';
            ctx.fillRect(cx + bx, cy + by, Math.min(bk, cs - bx), Math.min(bk, cs - by));
          }
        }
      } else {
        const info = colorData[code] || window.appState.fullPalette[code];
        const hex = info ? info.hex : '#FFFFFF';

        ctx.fillStyle = hex;
        ctx.fillRect(cx, cy, cs, cs);

        // Highlight mask
        if (activeColors.size > 0 && !activeColors.has(code)) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
          ctx.fillRect(cx, cy, cs, cs);
        }

        // Draw code text inside cell
        if (showCodes) {
          const r = parseInt(hex.slice(1, 3), 16) || 255;
          const g = parseInt(hex.slice(3, 5), 16) || 255;
          const b = parseInt(hex.slice(5, 7), 16) || 255;
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          ctx.fillStyle = brightness > 128 ? '#000000' : '#FFFFFF';
          ctx.font = `bold ${Math.max(6, cs * 0.38)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(code, cx + cs / 2, cy + cs / 2);
        }
      }
    }
  }

  // --- Draw grid lines ---
  if (cs >= 4) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 0.5;

    for (let x = 0; x <= gridSize.width; x++) {
      ctx.beginPath();
      ctx.moveTo(ox + x * cs, oy);
      ctx.lineTo(ox + x * cs, oy + patternH);
      ctx.stroke();
    }
    for (let y = 0; y <= gridSize.height; y++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + y * cs);
      ctx.lineTo(ox + patternW, oy + y * cs);
      ctx.stroke();
    }
  }
}

// === Canvas Click Handling ===
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('pattern-canvas');
  if (!canvas) return;

  canvas.addEventListener('click', (e) => {
    if (!window.appState.editMode || !window.appState.pixelMatrix) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    const cellSize = canvas._cellSize || 10;
    const coordSize = canvas._coordSize || 20;
    const col = Math.floor((canvasX - coordSize) / cellSize);
    const row = Math.floor((canvasY - coordSize) / cellSize);

    if (row >= 0 && row < window.appState.gridSize.height &&
        col >= 0 && col < window.appState.gridSize.width) {
      showColorPopover(e.clientX, e.clientY, row, col);
    }
  });

  // Hover effect in edit mode
  canvas.addEventListener('mousemove', (e) => {
    if (!window.appState.editMode || !window.appState.pixelMatrix) {
      canvas.style.cursor = 'default';
      return;
    }
    canvas.style.cursor = 'crosshair';
  });
});

// === Color Popover ===
function showColorPopover(clientX, clientY, row, col) {
  // Remove existing popover
  closeColorPopover();

  const popover = document.createElement('div');
  popover.className = 'color-popover';
  popover.id = 'color-popover';

  // Position
  popover.style.left = clientX + 'px';
  popover.style.top = clientY + 'px';

  // Adjust if near edge
  const maxLeft = window.innerWidth - 220;
  const maxTop = window.innerHeight - 260;
  if (clientX > maxLeft) popover.style.left = maxLeft + 'px';
  if (clientY > maxTop) popover.style.top = maxTop + 'px';

  // Current cell info
  const currentCode = window.appState.pixelMatrix[row][col];

  // Add color options from current preset (all colors in preset, not just used ones)
  const presetColors = getPresetColorList();
  presetColors.forEach(item => {
    const opt = document.createElement('div');
    opt.className = 'color-popover-item';
    if (item.code === currentCode) {
      opt.style.background = 'var(--accent-light)';
    }
    opt.innerHTML = `
      <span class="color-swatch" style="background: ${item.hex}"></span>
      <span style="font-weight: 600">${item.code}</span>
      <span style="color: var(--text-secondary)">${item.name}</span>
    `;
    opt.addEventListener('click', () => {
      updateCell(row, col, item.code);
      closeColorPopover();
    });
    popover.appendChild(opt);
  });

  document.body.appendChild(popover);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', outsideClickHandler);
  }, 10);
}

function outsideClickHandler(e) {
  const popover = document.getElementById('color-popover');
  if (popover && !popover.contains(e.target)) {
    closeColorPopover();
  }
}

function closeColorPopover() {
  const existing = document.getElementById('color-popover');
  if (existing) existing.remove();
  document.removeEventListener('click', outsideClickHandler);
}

// === Update Cell ===
async function updateCell(row, col, newCode) {
  const { pixelMatrix, sessionId } = window.appState;
  const oldCode = pixelMatrix[row][col];
  if (oldCode === newCode) return;

  // Update locally first for instant feedback
  pixelMatrix[row][col] = newCode;
  renderCanvas();

  // Sync with server
  try {
    const response = await fetch('/api/update_cell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        row: row,
        col: col,
        new_code: newCode,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      window.appState.colorSummary = data.color_summary;
      window.appState.totalBeads = data.total_beads;

      // Rebuild colorData
      window.appState.colorData = {};
      data.color_summary.forEach(c => {
        window.appState.colorData[c.code] = c;
      });

      renderColorPanel();
    }
  } catch (err) {
    // Revert on error
    pixelMatrix[row][col] = oldCode;
    renderCanvas();
    showToast(t('toast.update_failed'), true);
  }
}

// === Color Panel ===
function renderColorPanel() {
  const list = document.getElementById('color-list');
  const total = document.getElementById('color-total');
  if (!list) return;

  list.innerHTML = '';

  window.appState.colorSummary.forEach(item => {
    const tag = document.createElement('div');
    tag.className = 'color-tag' + (window.appState.activeColors.has(item.code) ? ' active' : '');
    tag.dataset.code = item.code;
    tag.title = `${item.name} (${item.code})`;
    tag.innerHTML = `
      <span class="color-swatch" style="background: ${item.hex}"></span>
    `;

    tag.addEventListener('click', () => {
      toggleColorHighlight(item.code);
    });

    list.appendChild(tag);
  });

  if (total) {
    total.textContent = t('result.colors_total', { colors: window.appState.colorSummary.length, beads: window.appState.totalBeads });
  }
}

// === Color Highlight Toggle ===
function toggleColorHighlight(code) {
  const { activeColors } = window.appState;
  const isSameSelection = activeColors.size === 1 && activeColors.has(code);

  activeColors.clear();

  if (!isSameSelection) {
    activeColors.add(code);
  }

  // Update tag UI
  document.querySelectorAll('.color-tag').forEach(tag => {
    tag.classList.toggle('active', activeColors.has(tag.dataset.code));
  });

  renderCanvas();
  
  // Sync to ESP32
  sendHighlightToESP32();
}

// === Send Highlight to ESP32 ===
async function sendHighlightToESP32() {
  const { pixelMatrix, activeColors, colorData, fullPalette } = window.appState;
  if (!pixelMatrix) return;
  
  const highlightRGB = [];
  activeColors.forEach(code => {
    const info = colorData[code] || fullPalette[code];
    if (info?.rgb) {
      highlightRGB.push(info.rgb);
    }
  });
  
  try {
    if (window.appState.bleCharacteristic && window.appState.bleDevice?.gatt?.connected) {
      await sendHighlightViaWebBluetooth(highlightRGB);
    }
  } catch (err) {
    console.error('ESP32 highlight sync failed:', err);
  }
}

// === Background Removal Toggle ===
let backgroundRemovalEnabled = true;  // Default ON

function toggleBackground() {
  backgroundRemovalEnabled = !backgroundRemovalEnabled;
  const btn = document.getElementById('bg-toggle');
  if (btn) {

    if (backgroundRemovalEnabled) {
      btn.style.borderStyle = 'dashed';
      btn.style.borderColor = '#999';
    } else {
      btn.style.borderStyle = 'solid';
      btn.style.borderColor = '#333';
    }
  }
  // Auto-regenerate pattern
  if (window.appState.originalImage) {
    generatePattern();
  }
}

// === Export PNG ===
async function exportPNG() {
  const { pixelMatrix, colorData, colorSummary, palettePreset, fullPalette } = window.appState;
  if (!pixelMatrix) return;

  // Build color_data map: code -> hex (include fullPalette fallback)
  const colorMap = {};
  Object.keys(colorData).forEach(code => {
    colorMap[code] = colorData[code].hex;
  });
  // Ensure all codes in pixel_matrix are covered
  pixelMatrix.forEach(row => {
    row.forEach(code => {
      if (code && !colorMap[code] && fullPalette[code]) {
        colorMap[code] = fullPalette[code].hex;
      }
    });
  });

  try {
    const response = await fetch('/api/export/png', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: window.appState.sessionId,
        pixel_matrix: pixelMatrix,
        color_data: colorMap,
        color_summary: colorSummary,
        cell_size: 20,
        show_grid: true,
        show_codes_in_cells: true,
        show_coordinates: true,
        palette_preset: palettePreset,
      }),
    });

    if (!response.ok) throw new Error('Export failed');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beadcraft_pattern_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(t('toast.png_success'));
  } catch (err) {
    showToast(t('toast.png_failed'), true);
  }
}

// === Export PDF ===
async function exportPDF() {
  const { pixelMatrix, colorSummary, sessionId, palettePreset } = window.appState;
  if (!pixelMatrix) return;

  try {
    const response = await fetch('/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        pixel_matrix: pixelMatrix,
        color_summary: colorSummary,
        show_codes_in_cells: true,
        show_coordinates: true,
        palette_preset: palettePreset,
      }),
    });

    if (!response.ok) throw new Error('Export failed');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beadcraft_pattern_${Date.now()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(t('toast.pdf_success'));
  } catch (err) {
    showToast(t('toast.pdf_failed'), true);
  }
}

// === Export JSON ===
async function exportJSON() {
  const { pixelMatrix, colorSummary } = window.appState;
  if (!pixelMatrix) return;

  try {
    const response = await fetch('/api/export/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pixel_matrix: pixelMatrix,
        color_summary: colorSummary,
      }),
    });

    if (!response.ok) throw new Error('Export failed');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beadcraft_pattern_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(t('toast.json_export_success'));
  } catch (err) {
    showToast(t('toast.json_export_failed'), true);
  }
}

// === Connection Settings Dialog ===
function setConnectionMode() {
  const bleSettings = document.getElementById('ble-settings');
  if (bleSettings) bleSettings.style.display = 'block';
  updateConnectionModeQuickButton();
  renderBleStatus();
}

async function showSerialSettings() {
  document.getElementById('serial-settings-dialog').style.display = 'flex';
  await refreshBLEDevices();
}

function hideSerialSettings() {
  document.getElementById('serial-settings-dialog').style.display = 'none';
}

function showExportDialog() {
  document.getElementById('export-dialog').style.display = 'flex';
}

function hideExportDialog() {
  document.getElementById('export-dialog').style.display = 'none';
}

// === BLE Device Scanning ===
async function refreshBLEDevices() {
  if (!isWebBluetoothAvailable()) {
    window.appState.bleKnownDevices = [];
    renderBleDeviceList();
    renderBleStatus();
    return;
  }

  window.appState.bleKnownDevices = await getAuthorizedBLEDevices();
  renderBleDeviceList();
  renderBleStatus();
}

async function completeBLEConnectionFlow() {
  const uuid = rememberConnectedBleTarget() || getConnectedBleUuid();
  showToast(uuid ? t('toast.ble_connected', {uuid: uuid}) : t('toast.ble_connected_simple'));
  await refreshBLEDevices();
  renderBleStatus();
}

async function connectKnownBLEDevice(deviceKey) {
  const device = (window.appState.bleKnownDevices || []).find((item) => getBleDeviceKey(item) === deviceKey);
  if (!device) {
    showToast(t('ble.no_device_hint'), true);
    return;
  }

  try {
    setActiveBleDevice(device);
    renderBleDeviceList();
    renderBleStatus();
    await ensureBLECharacteristic(false);
    await completeBLEConnectionFlow();
  } catch (err) {
    await refreshBLEDevices();
    if (err?.name !== 'NotFoundError') {
      showToast(err.message || 'Bluetooth connection failed', true);
    }
  }
}

async function connectBLEDevice() {
  try {
    await requestBLEDevice();
    await ensureBLECharacteristic(false);
    await completeBLEConnectionFlow();
  } catch (err) {
    await refreshBLEDevices();
    if (err?.name !== 'NotFoundError') {
      showToast(err.message || 'Bluetooth connection failed', true);
    }
  }
}

async function addBLEDevice() {
  try {
    await requestBLEDevice(true);
    await ensureBLECharacteristic(false);
    await completeBLEConnectionFlow();
  } catch (err) {
    await refreshBLEDevices();
    if (err?.name !== 'NotFoundError') {
      showToast(err.message || 'Bluetooth connection failed', true);
    }
  }
}

// === One-Click Send to ESP32 ===
async function sendToESP32Direct() {
  const { pixelMatrix, isSending } = window.appState;
  if (!pixelMatrix) {
    showToast(t('toast.generate_first'), true);
    return;
  }
  if (isSending) {
    console.log('[ESP32] Send already in progress, skipping');
    return;
  }
  window.appState.isSending = true;
  const bgRgb = [0, 0, 0];

  // Show toast
  const toast = document.getElementById('serial-toast');
  toast.textContent = 'Connecting via Bluetooth...';
  toast.className = 'serial-toast';
  toast.style.display = 'block';

  try {
    const result = await sendMatrixViaCurrentMode(pixelMatrix, bgRgb, true);

    if (result.success) {
      toast.textContent = `Sent ${result.bytes_sent} bytes in ${result.duration_ms}ms`;
      toast.className = 'serial-toast success';
      showToast('Image sent via Bluetooth!');
    } else {
      toast.textContent = result.message;
      toast.className = 'serial-toast error';
    }

    // Hide toast after 3s
    setTimeout(() => {
      toast.style.display = 'none';
    }, 3000);

  } catch (err) {
    const message = err?.name === 'NotFoundError'
      ? t('ble.no_device')
      : (err?.message || 'Bluetooth send failed');
    toast.textContent = message;
    toast.className = 'serial-toast error';
    showToast(message, true);
    setTimeout(() => {
      toast.style.display = 'none';
    }, 3000);
  } finally {
    window.appState.isSending = false;
  }
}

async function refreshSerialPorts(autoSelect = false) {
  const select = document.getElementById('serial-port-select');
  select.innerHTML = '<option value="">' + t('serial.scanning') + '</option>';

  try {
    const response = await fetch('/api/serial/ports');
    if (!response.ok) throw new Error('Failed to list ports');

    const data = await response.json();
    const ports = data.ports || [];

    if (ports.length === 0) {
      select.innerHTML = '<option value="">' + t('serial.no_ports') + '</option>';
      return;
    }

    select.innerHTML = '<option value="">' + t('serial.select_port') + '</option>';
    
    let esp32Port = null;
    
    ports.forEach(port => {
      const opt = document.createElement('option');
      opt.value = port.device;
      opt.textContent = port.description || port.device;
      select.appendChild(opt);
      
      // Auto-detect ESP32 port by common identifiers
      const desc = (port.description || '').toLowerCase();
      const hwid = (port.hwid || '').toLowerCase();
      if (desc.includes('esp32') || desc.includes('ch340') || desc.includes('ch341') ||
          desc.includes('cp210') || desc.includes('cp2102') || desc.includes('cp2104') ||
          desc.includes('usb-serial') || hwid.includes('esp32') || hwid.includes('ch340')) {
        if (!esp32Port) {
          esp32Port = port.device;
        }
      }
    });
    
    // Auto-select ESP32 port if found and requested
    if (autoSelect && esp32Port) {
      select.value = esp32Port;
    }

  } catch (err) {
    select.innerHTML = '<option value="">' + t('serial.scan_failed') + '</option>';
  }
}













