// === BeadCraft Frontend Application ===

// Global state
window.appState = {
  originalImage: null,
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
  bleServer: null,
  bleCharacteristic: null,
  bleWifiScanCharacteristic: null,
  bleNotifyReady: false,
  bleWifiScanNotifyReady: false,
  connectionMode: 'ble',
  qrScannerMode: 'ble',
  wifiScanResults: [],
  pendingBleAction: null,
  selectedWifiNetwork: null,
  wifiDeviceIp: null,
  isSending: false,        // Lock to prevent concurrent sends
};

// === Persistent State (localStorage) ===
function loadPersistentState() {
  try {
    const saved = localStorage.getItem('beadcraft_state');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.targetDeviceUuid) window.appState.targetDeviceUuid = data.targetDeviceUuid;
      if (data.connectionMode === 'ble' || data.connectionMode === 'wifi') {
        window.appState.connectionMode = data.connectionMode;
      }
      if (data.qrScannerMode) window.appState.qrScannerMode = data.qrScannerMode;
    }
  } catch (e) {
    console.warn('Failed to load persistent state:', e);
  }
}

function savePersistentState() {
  try {
    const data = {
      targetDeviceUuid: window.appState.targetDeviceUuid,
      connectionMode: window.appState.connectionMode,
      qrScannerMode: window.appState.qrScannerMode,
    };
    localStorage.setItem('beadcraft_state', JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save persistent state:', e);
  }
}

const BLE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const BLE_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea0734b3e6c1';
const BLE_WIFI_SCAN_CHARACTERISTIC_UUID = '9f6b2a1d-6a52-4f4e-93c7-8d9c6d41e7a1';
const BLE_IMAGE_SIZE = 8192;
const BLE_CHUNK_SIZE = 19;
const BLE_ACK_TIMEOUT_MS = 5000;
const BLE_SEND_MAX_RETRIES = 3;
const BLE_PACKET_GAP_MS = 8;
const BLE_WIFI_SCAN_TIMEOUT_MS = 15000;
const BLE_PKT_WIFI_SCAN = 0x07;
const BLE_PKT_WIFI_CONNECT = 0x08;
const BLE_NTF_WIFI_SCAN_BEGIN = 0x21;
const BLE_NTF_WIFI_SCAN_DATA = 0x22;
const BLE_NTF_WIFI_SCAN_END = 0x23;
const BLE_NTF_WIFI_SCAN_ERROR = 0x24;

let bleAckWaiters = [];
let bleWifiScanWaiters = [];
let bleWifiScanBuffer = '';
let bleWifiScanPendingResult = null;
let bleWifiScanPendingError = null;
let bleWifiConnectWaiters = [];
let bleWifiConnectPendingResult = null;
let bleWifiConnectPendingError = null;

let qrScannerState = {
  stream: null,
  detector: null,
  intervalId: null,
  active: false,
  canvas: null,
  context: null,
};

// === Clear Canvas ===
function clearCanvas() {
  // Reset state
  window.appState.originalImage = null;
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

// === Initialization ===
document.addEventListener('DOMContentLoaded', () => {
  // Load persistent state first
  loadPersistentState();
  
  const params = new URLSearchParams(window.location.search);
  const targetDeviceUuid = (params.get('device_uuid') || params.get('u') || '').trim().toUpperCase();
  // URL param takes priority over saved state
  if (targetDeviceUuid) {
    window.appState.targetDeviceUuid = targetDeviceUuid;
    savePersistentState();
  }

  loadFullPalette();
  initUpload();
  applyTranslations();
  updateConnectionModeQuickButton();
  setConnectionMode(window.appState.connectionMode || 'ble');
  
  // Auto-generate pattern when LED size changes
  const ledSizeSelect = document.getElementById('led-matrix-size');
  if (ledSizeSelect) {
    ledSizeSelect.addEventListener('change', () => {
      if (window.appState.originalImage) {
        generatePattern();
      }
    });
  }
});

function getConnectionModeLabel(mode) {
  if (mode === 'ble') return t('ble.mode_ble');
  if (mode === 'wifi') return 'WiFi';
  return t('ble.mode_default');
}

function updateConnectionModeQuickButton() {
  const btn = document.getElementById('mode-quick-btn');
  if (!btn) return;
  const mode = window.appState.connectionMode || 'ble';
  btn.textContent = getConnectionModeLabel(mode);
  btn.title = t('ble.connection_mode', {mode: getConnectionModeLabel(mode)});
}

function cycleConnectionMode() {
  const modes = ['ble', 'wifi'];
  const current = window.appState.connectionMode || 'ble';
  const index = modes.indexOf(current);
  const next = modes[(index + 1) % modes.length];
  setConnectionMode(next);
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
    window.appState.originalImage = file;
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

function setQrScannerStatus(message, isError = false) {
  const status = document.getElementById('qr-scanner-status');
  if (!status) return;
  status.textContent = message;
  status.style.color = isError ? 'var(--danger)' : 'var(--text-secondary)';
}

function updateQrScannerConnectionUi() {
  const hidePairing = window.appState.qrScannerMode === 'wifi' && hasMatchingConnectedBLEDevice();
  const frame = document.getElementById('qr-scanner-frame');
  const actions = document.getElementById('qr-scanner-actions');
  const manual = document.getElementById('qr-scanner-manual');
  if (frame) frame.style.display = hidePairing ? 'none' : '';
  if (actions) actions.style.display = hidePairing ? 'none' : '';
  if (manual) manual.style.display = hidePairing ? 'none' : '';
}

function renderQrWifiSelection() {
  const panel = document.getElementById('qr-wifi-connect-panel');
  const selected = document.getElementById('qr-wifi-selected');
  const password = document.getElementById('qr-wifi-password');
  const button = document.getElementById('qr-wifi-connect-btn');
  const network = window.appState.selectedWifiNetwork;
  if (!panel || !selected || !password || !button) return;

  if (!network) {
    panel.style.display = 'none';
    selected.textContent = '';
    password.value = '';
    return;
  }

  panel.style.display = 'flex';
  selected.textContent = t('wifi.selected_network', {ssid: network.ssid});
  password.style.display = network.secured ? '' : 'none';
  password.placeholder = t('wifi.password_for', {ssid: network.ssid});
  if (!network.secured) {
    password.value = '';
  } else {
    setTimeout(() => password.focus(), 0);
  }
  button.textContent = network.secured ? t('wifi.connect_with_password') : t('wifi.connect_open');
}

function selectQrWifiNetwork(ssid) {
  const normalized = (ssid || '').trim();
  window.appState.selectedWifiNetwork = window.appState.wifiScanResults.find(item => item.ssid === normalized) || null;
  document.querySelectorAll('.qr-wifi-item').forEach((row) => {
    row.classList.toggle('selected', row.dataset.ssid === normalized);
  });
  renderQrWifiSelection();
}

function renderQrWifiScanResults(results = [], emptyMessage = t('wifi.scan_results_placeholder')) {
  const panel = document.getElementById('qr-wifi-panel');
  const list = document.getElementById('qr-wifi-list');
  if (!panel || !list) return;

  panel.style.display = window.appState.qrScannerMode === 'wifi' ? 'block' : 'none';
  list.innerHTML = '';
  window.appState.selectedWifiNetwork = null;
  renderQrWifiSelection();

  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'qr-wifi-empty';
    empty.textContent = emptyMessage;
    list.appendChild(empty);
    return;
  }

  results.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'qr-wifi-item';
    row.dataset.ssid = item.ssid;
    row.innerHTML = `
      <div class="qr-wifi-item-main">
        <div class="qr-wifi-item-ssid">${item.ssid}</div>
        <div class="qr-wifi-item-meta">${t('wifi.signal')} ${item.rssi} dBm</div>
      </div>
      <div class="qr-wifi-item-lock">${item.secured ? t('wifi.secured') : t('wifi.open')}</div>
    `;
    row.addEventListener('click', () => selectQrWifiNetwork(item.ssid));
    list.appendChild(row);
  });
}

function updateQrScannerModeUi() {
  const mode = window.appState.qrScannerMode || 'ble';
  const bleBtn = document.getElementById('qr-mode-ble-btn');
  const wifiBtn = document.getElementById('qr-mode-wifi-btn');
  const submitBtn = document.getElementById('qr-manual-submit-btn');
  const input = document.getElementById('manual-uuid-input');

  if (bleBtn) bleBtn.classList.toggle('active', mode === 'ble');
  if (wifiBtn) wifiBtn.classList.toggle('active', mode === 'wifi');
  if (submitBtn) submitBtn.textContent = mode === 'wifi' ? t('wifi.scan_hotspots') : t('wifi.connect_uuid');
  if (input) input.placeholder = mode === 'wifi' ? 'Enter device UUID then scan hotspots' : 'Enter device UUID';
  updateQrScannerConnectionUi();

  if (mode === 'wifi') {
    renderQrWifiScanResults(window.appState.wifiScanResults, t('wifi.scan_hint'));
  } else {
    renderQrWifiScanResults([], t('wifi.scan_results_placeholder'));
  }
}

function setQrScannerMode(mode) {
  if (mode !== 'ble' && mode !== 'wifi') return;
  window.appState.qrScannerMode = mode;
  setConnectionMode(mode);
  updateQrScannerModeUi();
  setQrScannerStatus(mode === 'wifi'
    ? 'Scan device QR first, then connect ESP32 over Bluetooth and start WiFi scan'
    : t('qr.scan_hint'));
}

function stopQrScannerLoop() {
  if (qrScannerState.intervalId) {
    clearInterval(qrScannerState.intervalId);
    qrScannerState.intervalId = null;
  }
}

function stopQrScannerStream() {
  if (qrScannerState.stream) {
    qrScannerState.stream.getTracks().forEach(track => track.stop());
    qrScannerState.stream = null;
  }

  const video = document.getElementById('qr-scanner-video');
  if (video) {
    video.srcObject = null;
  }
}

function closeQrScanner() {
  qrScannerState.active = false;
  stopQrScannerLoop();
  stopQrScannerStream();
  const dialog = document.getElementById('qr-scanner-dialog');
  if (dialog) {
    dialog.style.display = 'none';
  }

  const qrImageInput = document.getElementById('qr-image-input');
  if (qrImageInput) {
    qrImageInput.value = '';
  }

  const manualUuidInput = document.getElementById('manual-uuid-input');
  if (manualUuidInput) {
    manualUuidInput.value = '';
  }

  window.appState.wifiScanResults = [];
  renderQrWifiScanResults([], t('wifi.scan_results_placeholder'));
}

function showBleQuickConnect(uuid) {
  const container = document.getElementById('ble-quick-connect');
  const text = document.getElementById('ble-quick-connect-text');
  if (!container || !text) return;

  const mode = window.appState.pendingBleAction === 'wifi-scan' ? t('ble.scan_nearby') : t('ble.connect_esp32');
  text.textContent = t('ble.target_locked', {uuid: uuid, mode: mode});
  container.style.display = 'block';
}

function hideBleQuickConnect() {
  const container = document.getElementById('ble-quick-connect');
  if (container) {
    container.style.display = 'none';
  }
}

async function confirmBleQuickConnect() {
  hideBleQuickConnect();
  if (!window.appState.targetDeviceUuid) return;

  const mode = window.appState.pendingBleAction === 'wifi-scan' ? ' and scan hotspots' : '';
  showToast(t('ble.connecting_to', {uuid: window.appState.targetDeviceUuid, mode: mode}));
  try {
    if (window.appState.pendingBleAction === 'wifi-scan') {
      await connectAndScanWiFiForTarget(window.appState.targetDeviceUuid);
    } else {
      await connectBLEDevice();
    }
  } catch (err) {
    const message = err?.name === 'NotFoundError'
      ? t('ble.no_device')
      : (err?.message || t('ble.connect_failed'));
    showToast(message, true);
  } finally {
    window.appState.pendingBleAction = null;
  }
}

function handleQrScanResult(rawValue) {
  if (!rawValue) return;

  closeQrScanner();

  try {
    const normalizedValue = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawValue)
      ? rawValue
      : `https://${rawValue}`;
    const scannedUrl = new URL(normalizedValue, window.location.origin);
    window.location.href = scannedUrl.toString();
  } catch (err) {
    const manualUuid = rawValue.trim().toUpperCase();
    if (/^[0-9A-F]{12}$/.test(manualUuid)) {
      applyManualUuid(manualUuid);
      return;
    }
    showToast(t('qr.invalid_content'), true);
  }
}

function applyManualUuid(uuid) {
  const normalized = (uuid || '').trim().toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(normalized)) {
    showToast(t('toast.uuid_format'), true);
    return;
  }

  const targetUrl = new URL(window.location.href);
  targetUrl.searchParams.set('u', normalized);
  targetUrl.searchParams.delete('device_uuid');
  window.location.href = targetUrl.toString();
}

function connectByManualUuid() {
  const input = document.getElementById('manual-uuid-input');
  if (!input) return;
  applyManualUuid(input.value);
}

function syncTargetUuidToUrl(uuid) {
  const targetUrl = new URL(window.location.href);
  targetUrl.searchParams.set('u', uuid);
  targetUrl.searchParams.delete('device_uuid');
  window.history.replaceState({}, '', targetUrl.toString());
}

async function beginUuidPairing(uuid, tryImmediateConnect = false) {
  const normalized = (uuid || '').trim().toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(normalized)) {
    throw new Error(t('toast.uuid_format'));
  }

  window.appState.targetDeviceUuid = normalized;
  syncTargetUuidToUrl(normalized);
  savePersistentState();
  setConnectionMode('ble');
  renderBleStatus();

  if (!tryImmediateConnect) {
    return;
  }

  try {
    await connectBLEDevice();
  } catch (err) {
    const message = err?.name === 'SecurityError'
      ? 'Browser blocked auto Bluetooth connect. Tap Connect Device to continue'
      : (err?.name === 'NotFoundError'
          ? t('ble.no_device')
          : (err?.message || t('ble.connect_failed')));
    showToast(message, true);
  }
}

async function handleQrScanResult(rawValue) {
  if (!rawValue) return;

  closeQrScanner();

  try {
    const normalizedValue = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawValue)
      ? rawValue
      : `https://${rawValue}`;
    const scannedUrl = new URL(normalizedValue, window.location.origin);
    const scannedUuid = (scannedUrl.searchParams.get('u') || scannedUrl.searchParams.get('device_uuid') || '').trim().toUpperCase();
    if (scannedUuid) {
      await beginUuidPairing(scannedUuid, true);
      return;
    }
    window.location.href = scannedUrl.toString();
  } catch (err) {
    const manualUuid = rawValue.trim().toUpperCase();
    if (/^[0-9A-F]{12}$/.test(manualUuid)) {
      await beginUuidPairing(manualUuid, true);
      return;
    }
    showToast(t('qr.invalid_content'), true);
  }
}

async function applyManualUuid(uuid, tryImmediateConnect = false) {
  try {
    await beginUuidPairing(uuid, tryImmediateConnect);
  } catch (err) {
    showToast(err.message || t('uuid.invalid'), true);
  }
}

async function connectByManualUuid() {
  const input = document.getElementById('manual-uuid-input');
  if (!input) return;
  await applyManualUuid(input.value, true);
}

async function beginUuidPairing(uuid, tryImmediateConnect = false) {
  const normalized = (uuid || '').trim().toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(normalized)) {
    throw new Error(t('toast.uuid_format'));
  }

  window.appState.targetDeviceUuid = normalized;
  syncTargetUuidToUrl(normalized);
  savePersistentState();
  setConnectionMode('ble');
  renderBleStatus();
  hideBleQuickConnect();

  if (!tryImmediateConnect) {
    return;
  }

  showToast(t('ble.connecting_to', {uuid: normalized, mode: ''}));
  try {
    await connectBLEDevice();
  } catch (err) {
    if (err?.name === 'SecurityError') {
      showBleQuickConnect(normalized);
      return;
    }

    const message = err?.name === 'NotFoundError'
      ? t('ble.no_device')
      : (err?.message || t('ble.connect_failed'));
    showToast(message, true);
  }
}

async function handleQrScanResult(rawValue) {
  if (!rawValue) return;

  closeQrScanner();

  try {
    const normalizedValue = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawValue)
      ? rawValue
      : `https://${rawValue}`;
    const scannedUrl = new URL(normalizedValue, window.location.origin);
    const scannedUuid = (scannedUrl.searchParams.get('u') || scannedUrl.searchParams.get('device_uuid') || '').trim().toUpperCase();
    if (scannedUuid) {
      await beginUuidPairing(scannedUuid, true);
      return;
    }
    window.location.href = scannedUrl.toString();
  } catch (err) {
    const manualUuid = rawValue.trim().toUpperCase();
    if (/^[0-9A-F]{12}$/.test(manualUuid)) {
      await beginUuidPairing(manualUuid, true);
      return;
    }
    showToast(t('qr.invalid_content'), true);
  }
}

async function applyManualUuid(uuid, tryImmediateConnect = false) {
  try {
    await beginUuidPairing(uuid, tryImmediateConnect);
  } catch (err) {
    showToast(err.message || t('uuid.invalid'), true);
  }
}

async function connectByManualUuid() {
  const input = document.getElementById('manual-uuid-input');
  if (!input) return;
  await applyManualUuid(input.value, true);
}

async function scanCurrentQrFrame() {
  if (!qrScannerState.active) return;

  const video = document.getElementById('qr-scanner-video');
  if (!video || video.readyState < 2) return;

  try {
    if (qrScannerState.detector) {
      const barcodes = await qrScannerState.detector.detect(video);
      if (barcodes && barcodes.length > 0) {
        handleQrScanResult(barcodes[0].rawValue);
        return;
      }
    }

    if (typeof window.jsQR === 'function') {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return;

      if (!qrScannerState.canvas) {
        qrScannerState.canvas = document.createElement('canvas');
        qrScannerState.context = qrScannerState.canvas.getContext('2d', { willReadFrequently: true });
      }

      qrScannerState.canvas.width = width;
      qrScannerState.canvas.height = height;
      qrScannerState.context.drawImage(video, 0, 0, width, height);
      const imageData = qrScannerState.context.getImageData(0, 0, width, height);
      const code = window.jsQR(imageData.data, width, height);
      if (code?.data) {
        handleQrScanResult(code.data);
      }
    }
  } catch (err) {
    setQrScannerStatus('QR decode failed', true);
    stopQrScannerLoop();
  }
}

async function openQrScanner() {
  if (typeof BarcodeDetector === 'undefined' && typeof window.jsQR !== 'function') {
    showToast(t('toast.browser_no_qr'), true);
    return;
  }

  const dialog = document.getElementById('qr-scanner-dialog');
  const video = document.getElementById('qr-scanner-video');
  if (!dialog || !video) return;

  qrScannerState.detector = typeof BarcodeDetector !== 'undefined'
    ? new BarcodeDetector({ formats: ['qr_code'] })
    : null;
  qrScannerState.active = true;
  dialog.style.display = 'flex';
  window.appState.qrScannerMode = window.appState.connectionMode === 'wifi' ? 'wifi' : 'ble';
  window.appState.wifiScanResults = [];
  updateQrScannerModeUi();
  setQrScannerStatus(window.appState.qrScannerMode === 'wifi'
    ? 'Scan device QR first, then connect ESP32 over Bluetooth and start WiFi scan'
    : 'Place QR code in frame, or upload an image if camera is unavailable');

  if (!navigator.mediaDevices?.getUserMedia) {
    setQrScannerStatus(t('camera.unavailable'), true);
    return;
  }

  try {
    qrScannerState.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    video.srcObject = qrScannerState.stream;
    await video.play();
    stopQrScannerLoop();
    qrScannerState.intervalId = setInterval(() => {
      scanCurrentQrFrame();
    }, 300);
  } catch (err) {
    stopQrScannerStream();
    stopQrScannerLoop();
    if (!window.isSecureContext) {
      setQrScannerStatus('Mobile browsers usually block camera scan on HTTP. Use photo scan instead.', true);
    } else {
      setQrScannerStatus('Cannot access camera. Check permissions or use photo scan.', true);
    }
  }
}

function triggerQrImagePicker() {
  const input = document.getElementById('qr-image-input');
  if (input) {
    input.click();
  }
}

async function triggerQrHotspotScan() {
  if (window.appState.qrScannerMode !== 'wifi') {
    closeQrScanner();
    return;
  }

  const targetUuid = window.appState.targetDeviceUuid;
  if (!targetUuid) {
    setQrScannerStatus(t('qr.scan_device_first'), true);
    return;
  }

  try {
    await connectAndScanWiFiForTarget(targetUuid);
  } catch (err) {
    setQrScannerStatus(err.message || t('wifi.scan_failed'), true);
  }
}

async function handleQrImageSelection(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (typeof window.jsQR !== 'function') {
    showToast(t('toast.qr_unavailable'), true);
    return;
  }

  try {
    setQrScannerStatus(t('qr.recognizing'));
    const imageBitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(imageBitmap, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(imageData.data, canvas.width, canvas.height);

    if (code?.data) {
      handleQrScanResult(code.data);
      return;
    }

    setQrScannerStatus('QR code not detected. Retake a clearer photo.', true);
  } catch (err) {
    setQrScannerStatus(t('qr.recognize_failed'), true);
  }
}

async function beginUuidPairing(uuid, tryImmediateConnect = false) {
  const normalized = (uuid || '').trim().toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(normalized)) {
    throw new Error(t('toast.uuid_format'));
  }

  window.appState.targetDeviceUuid = normalized;
  syncTargetUuidToUrl(normalized);
  renderBleStatus();
  hideBleQuickConnect();

  if (window.appState.qrScannerMode === 'wifi') {
    setConnectionMode('wifi');
    stopQrScannerLoop();
    stopQrScannerStream();
    setQrScannerStatus(t('ble.connecting_scan', {uuid: normalized}));
    renderQrWifiScanResults([], t('esp32.scanning'));
    try {
      await connectAndScanWiFiForTarget(normalized);
    } catch (err) {
      if (err?.name === 'SecurityError') {
        window.appState.pendingBleAction = 'wifi-scan';
        showBleQuickConnect(normalized);
        setQrScannerStatus('Browser requires one more tap to continue Bluetooth flow.', true);
        return;
      }
      throw err;
    }
    return;
  }

  setConnectionMode('ble');
  if (!tryImmediateConnect) return;

  showToast(t('ble.connecting_to', {uuid: normalized, mode: ''}));
  try {
    await connectBLEDevice();
  } catch (err) {
    if (err?.name === 'SecurityError') {
      window.appState.pendingBleAction = 'ble-connect';
      showBleQuickConnect(normalized);
      return;
    }
    throw err;
  }
}

async function applyManualUuid(uuid, tryImmediateConnect = false) {
  try {
    await beginUuidPairing(uuid, tryImmediateConnect);
  } catch (err) {
    showToast(err.message || t('uuid.invalid'), true);
    setQrScannerStatus(err.message || t('uuid.invalid'), true);
  }
}

async function connectByManualUuid() {
  const input = document.getElementById('manual-uuid-input');
  if (!input) return;
  await applyManualUuid(input.value, true);
}

async function handleQrScanResult(rawValue) {
  if (!rawValue) return;

  try {
    const normalizedValue = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawValue)
      ? rawValue
      : `https://${rawValue}`;
    const scannedUrl = new URL(normalizedValue, window.location.origin);
    const scannedUuid = (scannedUrl.searchParams.get('u') || scannedUrl.searchParams.get('device_uuid') || '').trim().toUpperCase();
    if (scannedUuid) {
      if (window.appState.qrScannerMode === 'ble') {
        closeQrScanner();
      }
      await beginUuidPairing(scannedUuid, true);
      return;
    }
    window.location.href = scannedUrl.toString();
  } catch (err) {
    const manualUuid = rawValue.trim().toUpperCase();
    if (/^[0-9A-F]{12}$/.test(manualUuid)) {
      if (window.appState.qrScannerMode === 'ble') {
        closeQrScanner();
      }
      await beginUuidPairing(manualUuid, true);
      return;
    }
    showToast(t('qr.invalid_content'), true);
    setQrScannerStatus(t('qr.invalid_content'), true);
  }
}

function isWebBluetoothAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

function normalizeBleDeviceUuid(name) {
  if (!name || !name.startsWith('BeadCraft-')) return '';
  return name.slice('BeadCraft-'.length).trim().toUpperCase();
}

function updateBLEDeviceSelect(label, value = '') {
  const select = document.getElementById('ble-device-select');
  if (!select) return;

  select.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  select.appendChild(opt);
  select.value = value;
}

function renderBleStatus() {
  const chip = document.getElementById('ble-target-chip');
  const card = document.getElementById('ble-status-card');
  const connectBtn = document.getElementById('ble-connect-btn');
  const uploadArea = document.getElementById('upload-area');
  const targetUuid = (window.appState.targetDeviceUuid || '').trim().toUpperCase();
  const connectedUuid = normalizeBleDeviceUuid(window.appState.bleDevice?.name);
  const isConnected = !!window.appState.bleDevice?.gatt?.connected;

  if (uploadArea) {
    uploadArea.className = 'upload-area';
    uploadArea.onclick = () => document.getElementById('file-input').click();
    uploadArea.innerHTML = `
      <div class="upload-area-icon">+</div>
      <div class="upload-area-text">${t('upload.click_hint')}</div>
      <div class="upload-area-hint">${t('upload.format_hint')}</div>
    `;
  }

  if (chip) {
    if (isConnected && connectedUuid) {
      chip.style.display = 'inline-flex';
      chip.textContent = t('ble.device_connected', {uuid: connectedUuid});
    } else if (targetUuid) {
      chip.style.display = 'inline-flex';
      chip.textContent = t('ble.saved_device', {uuid: targetUuid});
    } else {
      chip.style.display = 'none';
      chip.textContent = '';
    }
  }

  if (card) {
    if (isConnected && connectedUuid) {
      card.style.display = 'block';
      card.className = 'ble-status-card connected';
      card.textContent = t('ble.device_connected', {uuid: connectedUuid});
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

  if (connectBtn) {
    connectBtn.textContent = isConnected ? t('ble.reconnect') : (targetUuid ? t('ble.connect_target', {uuid: targetUuid}) : t('ble.connect_device'));
  }
}

function onBLEDisconnected() {
  if (window.appState.bleCharacteristic) {
    window.appState.bleCharacteristic.removeEventListener('characteristicvaluechanged', handleBLENotification);
  }
  if (window.appState.bleWifiScanCharacteristic) {
    window.appState.bleWifiScanCharacteristic.removeEventListener('characteristicvaluechanged', handleBLEWiFiScanNotification);
  }
  window.appState.bleServer = null;
  window.appState.bleCharacteristic = null;
  window.appState.bleWifiScanCharacteristic = null;
  window.appState.bleNotifyReady = false;
  window.appState.bleWifiScanNotifyReady = false;
  bleAckWaiters = [];
  const uuid = window.appState.bleDevice
    ? normalizeBleDeviceUuid(window.appState.bleDevice.name)
    : window.appState.targetDeviceUuid;
  updateBLEDeviceSelect(uuid ? `${uuid} (disconnected)` : t('toast.ble_disconnected'));
  renderBleStatus();
  refreshWiFiDevices();
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

  if (code === BLE_NTF_WIFI_SCAN_BEGIN) {
    bleWifiScanBuffer = '';
    bleWifiScanPendingResult = null;
    bleWifiScanPendingError = null;
    return;
  }

  if (code === BLE_NTF_WIFI_SCAN_DATA) {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset + 1, dataView.byteLength - 1);
    bleWifiScanBuffer += new TextDecoder().decode(bytes);
    return;
  }

  if (code === BLE_NTF_WIFI_SCAN_END) {
    const results = parseWifiScanText(bleWifiScanBuffer);
    const waiter = bleWifiScanWaiters.shift();
    if (waiter) {
      waiter.resolve(results);
    } else {
      bleWifiScanPendingResult = results;
    }
    bleWifiScanBuffer = '';
    return;
  }

  if (code === BLE_NTF_WIFI_SCAN_ERROR) {
    const waiter = bleWifiScanWaiters.shift();
    if (waiter) {
      waiter.reject(new Error(t('esp32.wifi_scan_failed')));
    } else {
      bleWifiScanPendingError = new Error(t('esp32.wifi_scan_failed'));
    }
    bleWifiScanBuffer = '';
    return;
  }

  const status = String.fromCharCode(code);
  if (status === 'B') {
    bleWifiScanBuffer = '';
    bleWifiScanPendingResult = null;
    bleWifiScanPendingError = null;
    return;
  }

  if (status === 'D') {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset + 1, dataView.byteLength - 1);
    const results = parseWifiScanText(new TextDecoder().decode(bytes));
    const waiter = bleWifiScanWaiters.shift();
    if (waiter) {
      waiter.resolve(results);
    } else {
      bleWifiScanPendingResult = results;
    }
    return;
  }

  if (status === 'E') {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset + 1, dataView.byteLength - 1);
    const err = new Error(new TextDecoder().decode(bytes) || 'ESP32 WiFi scan failed');
    const waiter = bleWifiScanWaiters.shift();
    if (waiter) {
      waiter.reject(err);
    } else {
      bleWifiScanPendingError = err;
    }
  }
}

function handleBLEWiFiScanNotification(event) {
  const dataView = event.target?.value;
  if (!dataView || dataView.byteLength < 1) return;

  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  const code = bytes[0];
  const status = String.fromCharCode(code);
  const payload = new TextDecoder().decode(bytes.slice(1));
  console.log('[BLE][wifi-notify]', code, status, payload.slice(0, 80));

  if (status === 'B') {
    bleWifiScanBuffer = '';
    bleWifiScanPendingResult = null;
    bleWifiScanPendingError = null;
    return;
  }

  if (code === BLE_NTF_WIFI_SCAN_BEGIN) {
    bleWifiScanBuffer = '';
    bleWifiScanPendingResult = null;
    bleWifiScanPendingError = null;
    return;
  }

  if (code === BLE_NTF_WIFI_SCAN_DATA) {
    bleWifiScanBuffer += payload;
    return;
  }

  if (code === BLE_NTF_WIFI_SCAN_END) {
    const results = parseWifiScanText(bleWifiScanBuffer);
    const waiter = bleWifiScanWaiters.shift();
    if (waiter) {
      waiter.resolve(results);
    } else {
      bleWifiScanPendingResult = results;
    }
    bleWifiScanBuffer = '';
    return;
  }

  if (code === BLE_NTF_WIFI_SCAN_ERROR || status === 'E') {
    const err = new Error(payload || 'ESP32 WiFi scan failed');
    const waiter = bleWifiScanWaiters.shift();
    if (waiter) {
      waiter.reject(err);
    } else {
      bleWifiScanPendingError = err;
    }
    bleWifiScanBuffer = '';
    return;
  }

  if (status === 'C') {
    const waiter = bleWifiConnectWaiters.shift();
    if (waiter) {
      waiter.resolve(payload);
    } else {
      bleWifiConnectPendingResult = payload;
    }
    return;
  }

  if (status === 'F') {
    const err = new Error(payload || 'ESP32 WiFi connect failed');
    const waiter = bleWifiConnectWaiters.shift();
    if (waiter) {
      waiter.reject(err);
    } else {
      bleWifiConnectPendingError = err;
    }
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

function parseWifiScanText(rawText) {
  return (rawText || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [ssid = '', rssi = '', secured = '0'] = line.split('\t');
      return {
        ssid: ssid || '(Hidden SSID)',
        rssi: Number.parseInt(rssi, 10) || 0,
        secured: secured === '1',
      };
    })
    .sort((a, b) => b.rssi - a.rssi);
}

function waitForBLEWiFiScan(timeoutMs = BLE_WIFI_SCAN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (bleWifiScanPendingError) {
      const err = bleWifiScanPendingError;
      bleWifiScanPendingError = null;
      reject(err);
      return;
    }

    if (bleWifiScanPendingResult) {
      const result = bleWifiScanPendingResult;
      bleWifiScanPendingResult = null;
      resolve(result);
      return;
    }

    const timer = setTimeout(() => {
      const idx = bleWifiScanWaiters.findIndex(item => item.resolve === resolve);
      if (idx >= 0) bleWifiScanWaiters.splice(idx, 1);
      reject(new Error(t('wifi.scan_timeout')));
    }, timeoutMs);

    bleWifiScanWaiters.push({
      resolve: (results) => {
        clearTimeout(timer);
        resolve(results);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
  });
}

function waitForBLEWiFiConnect(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (bleWifiConnectPendingError) {
      const err = bleWifiConnectPendingError;
      bleWifiConnectPendingError = null;
      reject(err);
      return;
    }

    if (bleWifiConnectPendingResult) {
      const result = bleWifiConnectPendingResult;
      bleWifiConnectPendingResult = null;
      resolve(result);
      return;
    }

    const timer = setTimeout(() => {
      const idx = bleWifiConnectWaiters.findIndex(item => item.resolve === resolve);
      if (idx >= 0) bleWifiConnectWaiters.splice(idx, 1);
      reject(new Error('WiFi connect timeout'));
    }, timeoutMs);

    bleWifiConnectWaiters.push({
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
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

async function requestBLEDevice() {
  if (!isWebBluetoothAvailable()) {
    throw new Error('This browser does not support Web Bluetooth');
  }

  const targetUuid = window.appState.targetDeviceUuid;
  if (hasMatchingConnectedBLEDevice(targetUuid)) {
    const deviceUuid = normalizeBleDeviceUuid(window.appState.bleDevice?.name);
    updateBLEDeviceSelect(
      deviceUuid ? `${deviceUuid} (connected)` : 'Bluetooth connected',
      window.appState.bleDevice?.id || window.appState.bleDevice?.name || ''
    );
    renderBleStatus();
    return window.appState.bleDevice;
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'BeadCraft-' }],
    optionalServices: [BLE_SERVICE_UUID],
  });

  if (window.appState.bleDevice) {
    window.appState.bleDevice.removeEventListener('gattserverdisconnected', onBLEDisconnected);
  }

  window.appState.bleDevice = device;
  device.addEventListener('gattserverdisconnected', onBLEDisconnected);

  const deviceUuid = normalizeBleDeviceUuid(device.name);
  updateBLEDeviceSelect(deviceUuid ? `${deviceUuid} (${device.name})` : device.name || 'Bluetooth device', device.id || device.name || '');
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

  if (window.appState.bleCharacteristic && window.appState.bleWifiScanCharacteristic && window.appState.bleDevice.gatt.connected) {
    return window.appState.bleCharacteristic;
  }

  const server = await window.appState.bleDevice.gatt.connect();
  const service = await server.getPrimaryService(BLE_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);
  const wifiScanCharacteristic = await service.getCharacteristic(BLE_WIFI_SCAN_CHARACTERISTIC_UUID);
  if (!window.appState.bleNotifyReady) {
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', handleBLENotification);
    window.appState.bleNotifyReady = true;
  }
  if (!window.appState.bleWifiScanNotifyReady) {
    await wifiScanCharacteristic.startNotifications();
    wifiScanCharacteristic.addEventListener('characteristicvaluechanged', handleBLEWiFiScanNotification);
    window.appState.bleWifiScanNotifyReady = true;
  }

  window.appState.bleServer = server;
  window.appState.bleCharacteristic = characteristic;
  window.appState.bleWifiScanCharacteristic = wifiScanCharacteristic;

  const deviceUuid = normalizeBleDeviceUuid(window.appState.bleDevice.name);
  updateBLEDeviceSelect(deviceUuid ? `${deviceUuid} (connected)` : 'Bluetooth connected', window.appState.bleDevice.id || window.appState.bleDevice.name || '');
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

  for (const row of pixelMatrix) {
    for (const code of row) {
      let rgb = backgroundColor;
      if (code) {
        const colorInfo = window.appState.fullPalette[code] || window.appState.colorData[code];
        if (colorInfo && colorInfo.rgb) {
          rgb = colorInfo.rgb;
        } else {
          rgb = [255, 255, 255];
        }
      }

      const rgb565 = rgbToRgb565(rgb[0], rgb[1], rgb[2]);
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

async function requestWiFiScanViaWebBluetooth(requestIfNeeded = false) {
  const characteristic = await ensureBLECharacteristic(requestIfNeeded);
  await writeBLEPacket(characteristic, new Uint8Array([BLE_PKT_WIFI_SCAN]));
  const deadline = Date.now() + BLE_WIFI_SCAN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const value = await characteristic.readValue();
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (bytes.length > 0) {
      const status = String.fromCharCode(bytes[0]);
      const payload = new TextDecoder().decode(bytes.slice(1));
      if (status === 'D') {
        return parseWifiScanText(payload);
      }
      if (status === 'E') {
        throw new Error(payload || t('esp32.wifi_scan_failed'));
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error(t('wifi.scan_timeout'));
}

async function connectAndScanWiFiForTarget(uuid) {
  window.appState.pendingBleAction = 'wifi-scan';
  window.appState.targetDeviceUuid = uuid;
  window.appState.wifiScanResults = [];
  bleWifiScanBuffer = '';
  bleWifiScanPendingResult = null;
  bleWifiScanPendingError = null;
  bleWifiScanWaiters = [];
  syncTargetUuidToUrl(uuid);
  savePersistentState();
  renderBleStatus();
  setConnectionMode('wifi');
  const wifiSelect = document.getElementById('wifi-device-select');
  if (wifiSelect) {
    wifiSelect.innerHTML = `<option value="${uuid}">${uuid}</option>`;
    wifiSelect.value = uuid;
  }

  try {
    if (!hasMatchingConnectedBLEDevice(uuid)) {
      await requestBLEDevice();
    }
    await ensureBLECharacteristic(false);
    updateQrScannerConnectionUi();
    setQrScannerStatus(t('ble.connecting_scan', {uuid: uuid}));
    renderQrWifiScanResults([], t('esp32.scanning'));
    const results = await requestWiFiScanViaWebBluetooth(false);
    window.appState.wifiScanResults = results;
    renderQrWifiScanResults(results, t('wifi.no_results'));
    setQrScannerStatus(results.length ? t('wifi.found_count', {count: results.length}) : t('wifi.no_results'));
    const wifiStatusCard = document.getElementById('wifi-status-card');
    if (wifiStatusCard) {
      wifiStatusCard.textContent = results.length
        ? t('wifi.returned_results', {uuid: uuid, count: results.length})
        : t('wifi.no_hotspots', {uuid: uuid});
    }
    return results;
  } finally {
    window.appState.pendingBleAction = null;
  }
}

async function requestWiFiScanViaWebBluetooth(requestIfNeeded = false) {
  await ensureBLECharacteristic(requestIfNeeded);
  const characteristic = window.appState.bleWifiScanCharacteristic;
  const commandCharacteristic = window.appState.bleCharacteristic;
  if (!characteristic || !commandCharacteristic) {
    throw new Error('WiFi scan characteristic unavailable');
  }
  const waitTask = waitForBLEWiFiScan(BLE_WIFI_SCAN_TIMEOUT_MS);
  await writeBLEPacket(commandCharacteristic, new Uint8Array([BLE_PKT_WIFI_SCAN]));

  const pollTask = (async () => {
    const deadline = Date.now() + BLE_WIFI_SCAN_TIMEOUT_MS;
    let pollBuffer = '';
    while (Date.now() < deadline) {
      const value = await characteristic.readValue();
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (bytes.length > 0) {
        const code = bytes[0];
        const status = String.fromCharCode(code);
        const payload = new TextDecoder().decode(bytes.slice(1));
        console.log('[BLE][readValue]', code, status, payload.slice(0, 80));
        if (status === 'B' || code === BLE_NTF_WIFI_SCAN_BEGIN) {
          if (code === BLE_NTF_WIFI_SCAN_BEGIN) pollBuffer = '';
        } else if (code === BLE_NTF_WIFI_SCAN_DATA) {
          pollBuffer += payload;
        } else if (code === BLE_NTF_WIFI_SCAN_END) {
          return parseWifiScanText(pollBuffer);
        } else if (status === 'D') {
          return parseWifiScanText(payload);
        }
        if (code === BLE_NTF_WIFI_SCAN_ERROR || status === 'E') {
          throw new Error(payload || 'ESP32 WiFi scan failed');
        }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('WiFi scan timeout');
  })();

  const results = await Promise.allSettled([waitTask, pollTask]);
  const success = results.find(item => item.status === 'fulfilled');
  if (success) {
    return success.value;
  }
  throw results[0]?.reason || results[1]?.reason || new Error('WiFi scan failed');
}

async function connectSelectedQrWifi() {
  const network = window.appState.selectedWifiNetwork;
  if (!network) {
    showToast(t('wifi.select_first'), true);
    return;
  }

  const password = document.getElementById('qr-wifi-password')?.value || '';
  if (network.secured && !password) {
    showToast(t('wifi.enter_password'), true);
    return;
  }

  await ensureBLECharacteristic(false);
  const commandCharacteristic = window.appState.bleCharacteristic;
  if (!commandCharacteristic) {
    showToast(t('toast.ble_not_ready'), true);
    return;
  }

  const ssidBytes = new TextEncoder().encode(network.ssid);
  const passwordBytes = new TextEncoder().encode(password);
  if (ssidBytes.length > 60 || passwordBytes.length > 60) {
    showToast(t('toast.wifi_credentials_long'), true);
    return;
  }

  bleWifiConnectPendingResult = null;
  bleWifiConnectPendingError = null;
  bleWifiConnectWaiters = [];

  const packet = new Uint8Array(3 + ssidBytes.length + passwordBytes.length);
  packet[0] = BLE_PKT_WIFI_CONNECT;
  packet[1] = ssidBytes.length;
  packet[2] = passwordBytes.length;
  packet.set(ssidBytes, 3);
  packet.set(passwordBytes, 3 + ssidBytes.length);

  setQrScannerStatus(t('wifi.connecting', {ssid: network.ssid}));
  await writeBLEPacket(commandCharacteristic, packet);
  try {
    const result = await waitForBLEWiFiConnect();
    window.appState.wifiDeviceIp = result || null;
    if (window.appState.targetDeviceUuid && result) {
      await fetch('/api/wifi/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_uuid: window.appState.targetDeviceUuid,
          ip: result,
        }),
      });
    }
    setQrScannerStatus(result ? t('wifi.connected', {ssid: result}) : t('wifi.connected', {ssid: network.ssid}));
    showToast(t('wifi.connected', {ssid: network.ssid}));
    closeQrScanner();
  } catch (err) {
    setQrScannerStatus(err.message || t('wifi.connect_failed'), true);
    showToast(err.message || t('wifi.connect_failed'), true);
  }
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
  canvas.toBlob((blob) => {
    const croppedFile = new File([blob], cropState.file.name, { type: 'image/jpeg' });
    window.appState.originalImage = croppedFile;
    
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

// === Generate Pattern ===
async function generatePattern() {
  if (!window.appState.originalImage) {
    showToast(t('toast.upload_first'), true);
    return;
  }

  // Build form data
  const formData = new FormData();
  formData.append('file', window.appState.originalImage);

  // Check if custom size mode
  const difficultySelect = document.getElementById('difficulty-select');
  if (difficultySelect.value === 'custom') {
    const pixelSize = parseInt(document.getElementById('custom-pixel-slider')?.value) || 8;
    formData.append('mode', 'pixel_size');
    formData.append('pixel_size', pixelSize);
  } else {
    // Get difficulty scale from toolbar button
    const scale = parseFloat(difficultySelect.value) || 0.125;
    
    // Get original image dimensions
    const img = window.appState.originalImage;
    const imgWidth = img.width || img.naturalWidth || 512;
    const imgHeight = img.height || img.naturalHeight || 512;
    
    // Calculate grid size based on original image and difficulty
    const gridWidth = Math.max(16, Math.round(imgWidth * scale));
    const gridHeight = Math.max(16, Math.round(imgHeight * scale));
    
    formData.append('mode', 'fixed_grid');
    formData.append('grid_width', gridWidth);
    formData.append('grid_height', gridHeight);
  }
  
  // LED size for ESP32 display
  const ledSize = parseInt(document.getElementById('led-matrix-size').value) || 64;
  formData.append('led_size', ledSize);

  // Dithering (disabled by default)
  const dithering = document.getElementById('dithering-checkbox')?.checked || false;
  formData.append('use_dithering', dithering);

  // Palette preset
  formData.append('palette_preset', window.appState.palettePreset);

  // Max colors (0 = unlimited)
  const maxColorsSlider = document.getElementById('max-colors-slider');
  const maxColors = maxColorsSlider ? parseInt(maxColorsSlider.value) : 0;
  formData.append('max_colors', maxColors);

  // Similarity threshold (0 = disabled)
  const simSlider = document.getElementById('similarity-slider');
  const simThreshold = simSlider ? parseInt(simSlider.value) : 0;
  formData.append('similarity_threshold', simThreshold);

  // Background removal
  formData.append('remove_bg', backgroundRemovalEnabled);

  // Image adjustments
  const contrastVal = document.getElementById('contrast-slider')?.value || 0;
  formData.append('contrast', contrastVal);
  const saturationVal = document.getElementById('saturation-slider')?.value || 0;
  formData.append('saturation', saturationVal);
  const sharpnessVal = document.getElementById('sharpness-slider')?.value || 0;
  formData.append('sharpness', sharpnessVal);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch('/api/generate', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || 'Generation failed');
    }

    const data = await response.json();

    // Update state
    window.appState.sessionId = data.session_id;
    window.appState.pixelMatrix = data.pixel_matrix;
    window.appState.gridSize = data.grid_size;
    window.appState.colorSummary = data.color_summary;
    window.appState.totalBeads = data.total_beads;
    window.appState.activeColors = new Set();
    window.appState.editMode = false;
    window.appState.palettePreset = data.palette_preset || '221';

    // Build colorData lookup (include fullPalette fallback)
    window.appState.colorData = {};
    data.color_summary.forEach(c => {
      window.appState.colorData[c.code] = c;
    });

    // Render result: show canvas, hide upload-area, show color panel
    document.getElementById('upload-area').style.display = 'none';
    document.getElementById('pattern-canvas').style.display = 'block';
    document.getElementById('color-panel').style.display = 'block';
    renderCanvas();
    renderColorPanel();

    showToast(t('toast.pattern_result', { w: data.grid_size.width, h: data.grid_size.height, c: data.color_summary.length }));

    // Auto-send to ESP32 via serial
    await autoSendToESP32();

  } catch (err) {
    if (err.name === 'AbortError') {
      showToast(t('toast.timeout'), true);
    } else {
      showToast(err.message, true);
    }
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
  const { connectionMode } = window.appState;
  if (connectionMode === 'ble') {
    return await sendImageViaWebBluetooth(pixelMatrix, bgRgb, requestIfNeeded);
  }
  if (connectionMode === 'wifi') {
    const targetSize = getTargetLedSize();
    // Scale to LED size, then center in 64x64 canvas
    const mappedMatrix = scaleAndCenterImage(pixelMatrix, targetSize);
    const wifiUuid = (document.getElementById('wifi-device-select')?.value || window.appState.targetDeviceUuid || '').trim().toUpperCase();
    if (!wifiUuid) throw new Error(t('wifi.no_saved_device'));
    
    try {
      return await postJsonOrThrow('/api/wifi/send', {
        pixel_matrix: mappedMatrix,
        device_uuid: wifiUuid,
        background_color: bgRgb,
      }, 'WiFi send failed');
    } catch (err) {
      if (err.message && err.message.includes('is not registered')) {
        throw new Error(t('wifi.device_not_registered', {uuid: wifiUuid}));
      }
      throw err;
    }
  }
  throw new Error('Unsupported connection mode');
}

// === Auto Send to ESP32 after generation ===
async function autoSendToESP32() {
  const { pixelMatrix, connectionMode, isSending } = window.appState;
  if (!pixelMatrix) return;
  if (isSending) {
    console.log('[ESP32] Send already in progress, skipping');
    return;
  }
  window.appState.isSending = true;

  const bgColor = document.getElementById('serial-bg-color')?.value || '#000000';
  const bgRgb = [
    parseInt(bgColor.slice(1, 3), 16),
    parseInt(bgColor.slice(3, 5), 16),
    parseInt(bgColor.slice(5, 7), 16),
  ];

  // Show toast
  const toast = document.getElementById('serial-toast');
  if (toast) {
    toast.textContent = connectionMode === 'ble'
      ? 'Connecting via Bluetooth...'
      : 'Sending via server relay...';
    toast.className = 'serial-toast';
    toast.style.display = 'block';
  }

  try {
    const result = await sendMatrixViaCurrentMode(pixelMatrix, bgRgb, true);

    if (result.success) {
      if (toast) {
        toast.textContent = `Sent ${result.bytes_sent} bytes in ${result.duration_ms}ms`;
        toast.className = 'serial-toast success';
      }
      const okMsg = connectionMode === 'ble'
        ? 'Image sent via Bluetooth!'
        : 'Image sent via server relay!';
      showToast(okMsg);
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
  const { pixelMatrix, activeColors, connectionMode, colorData, fullPalette } = window.appState;
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
      return;
    }
    if (connectionMode !== 'wifi') return;

    const wifiUuid = (document.getElementById('wifi-device-select')?.value || window.appState.targetDeviceUuid || '').trim().toUpperCase();
    if (!wifiUuid) return;
    await fetch('/api/wifi/highlight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        highlight_colors: highlightRGB,
        device_uuid: wifiUuid,
      }),
    });
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
window.appState.connectionMode = 'ble';  // 'ble' | 'wifi'

function setConnectionMode(mode) {
  const normalizedMode = mode === 'wifi' ? 'wifi' : 'ble';
  window.appState.connectionMode = normalizedMode;
  savePersistentState();
  
  // Update button states
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === normalizedMode);
  });
  
  // Toggle visibility
  document.getElementById('ble-settings').style.display = normalizedMode === 'ble' ? 'block' : 'none';
  const wifiSettings = document.getElementById('wifi-settings');
  if (wifiSettings) wifiSettings.style.display = normalizedMode === 'wifi' ? 'block' : 'none';
  updateConnectionModeQuickButton();
  renderBleStatus();
  
  if (normalizedMode === 'ble') {
    refreshBLEDevices();
    return;
  }
  refreshWiFiDevices();
}

function showSerialSettings() {
  document.getElementById('serial-settings-dialog').style.display = 'flex';
  
  if (window.appState.connectionMode === 'ble') {
    refreshBLEDevices();
    return;
  }
  refreshWiFiDevices();
}

async function refreshWiFiDevices() {
  const statusCard = document.getElementById('wifi-status-card');
  const select = document.getElementById('wifi-device-select');
  const connectedUuid = normalizeBleDeviceUuid(window.appState.bleDevice?.name);
  const targetUuid = (window.appState.targetDeviceUuid || connectedUuid || '').trim().toUpperCase();

  if (targetUuid && targetUuid !== window.appState.targetDeviceUuid) {
    window.appState.targetDeviceUuid = targetUuid;
    savePersistentState();
  }

  if (select) {
    if (targetUuid) {
      select.innerHTML = `<option value="${targetUuid}">${targetUuid}</option>`;
      select.value = targetUuid;
    } else {
      select.innerHTML = '<option value="">' + t('wifi.select_device_hint') + '</option>';
    }
  }
  if (statusCard) {
    statusCard.textContent = targetUuid
      ? t('wifi.target_locked_scan', {uuid: targetUuid})
      : t('wifi.no_saved_device');
  }
}

function hideSerialSettings() {
  document.getElementById('serial-settings-dialog').style.display = 'none';
}

// === BLE Device Scanning ===
async function refreshBLEDevices() {
  if (!isWebBluetoothAvailable()) {
    updateBLEDeviceSelect(t('ble.bluetooth_unavailable'));
    renderBleStatus();
    return;
  }

  if (window.appState.bleDevice) {
    const uuid = normalizeBleDeviceUuid(window.appState.bleDevice.name);
    const status = window.appState.bleDevice.gatt?.connected ? 'connected' : 'selected';
    updateBLEDeviceSelect(uuid ? `${uuid} (${status})` : `Bluetooth ${status}`, window.appState.bleDevice.id || window.appState.bleDevice.name || '');
    renderBleStatus();
    return;
  }

  if (window.appState.targetDeviceUuid) {
    updateBLEDeviceSelect(t('ble.remembered_device', {uuid: window.appState.targetDeviceUuid}));
  } else {
    updateBLEDeviceSelect(t('ble.choose_device'));
  }
  renderBleStatus();
}

async function connectBLEDevice() {
  try {
    updateBLEDeviceSelect('Connecting...');
    await requestBLEDevice();
    await ensureBLECharacteristic(false);
    const uuid = normalizeBleDeviceUuid(window.appState.bleDevice?.name);
    if (uuid) {
      window.appState.targetDeviceUuid = uuid;
      syncTargetUuidToUrl(uuid);
      savePersistentState();
      refreshWiFiDevices();
    }
    showToast(uuid ? t('toast.ble_connected', {uuid: uuid}) : t('toast.ble_connected_simple'));
    refreshBLEDevices();
    renderBleStatus();
  } catch (err) {
    refreshBLEDevices();
    if (err?.name !== 'NotFoundError') {
      showToast(err.message || 'Bluetooth connection failed', true);
    }
  }
}

// === One-Click Send to ESP32 ===
async function sendToESP32Direct() {
  const { pixelMatrix, connectionMode, isSending } = window.appState;
  if (!pixelMatrix) {
    showToast(t('toast.generate_first'), true);
    return;
  }
  if (isSending) {
    console.log('[ESP32] Send already in progress, skipping');
    return;
  }
  window.appState.isSending = true;

  const bgColor = document.getElementById('serial-bg-color').value;
  const bgRgb = [
    parseInt(bgColor.slice(1, 3), 16),
    parseInt(bgColor.slice(3, 5), 16),
    parseInt(bgColor.slice(5, 7), 16),
  ];

  // Show toast
  const toast = document.getElementById('serial-toast');
  toast.textContent = connectionMode === 'ble'
    ? 'Connecting via Bluetooth...'
    : 'Sending via server relay...';
  toast.className = 'serial-toast';
  toast.style.display = 'block';

  try {
    const result = await sendMatrixViaCurrentMode(pixelMatrix, bgRgb, true);

    if (result.success) {
      toast.textContent = `Sent ${result.bytes_sent} bytes in ${result.duration_ms}ms`;
      toast.className = 'serial-toast success';
      const okMsg = connectionMode === 'ble'
        ? 'Image sent via Bluetooth!'
        : 'Image sent via server relay!';
      showToast(okMsg);
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













