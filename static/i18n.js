// === BeadCraft Internationalization ===

const I18N = {
  zh: {
    // Header
    'header.api_docs': 'API 文档',

    // Upload
    'upload.drop_hint': '拖放图片或点击上传',
    'upload.format_hint': 'JPG, PNG, GIF, WEBP (最大 20MB)',

    // Settings - Palette
    'settings.palette_preset': '色板预设',

    // Settings - Grid
    'settings.board_size': '拼豆板尺寸',
    'settings.fixed_grid': '固定网格',
    'settings.pixel_block': '像素块大小',
    'settings.pixel_block_label': '像素块大小:',
    'grid.small': '颗 (小)',
    'grid.1board': '颗 (1块板)',
    'grid.default': '颗',
    'grid.2x2': '颗 (2x2板)',
    'grid.3x3': '颗 (3x3板)',

    // Settings - Color
    'settings.color_controls': '颜色控制',
    'settings.max_colors': '最大颜色数:',
    'settings.max_colors_hint': '0 = 不限 (自动)。拖动滑块限制使用的颜色数量。',
    'settings.merge_threshold': '颜色合并阈值:',
    'settings.merge_hint': '合并相似颜色以减少总数。值越大合并越多。',

    // Settings - Adjustments
    'settings.image_adjustments': '图像调整',
    'settings.contrast': '对比度:',
    'settings.saturation': '饱和度:',
    'settings.sharpness': '锐度:',
    'settings.adjust_hint': '0 = 自动检测。向左减弱，向右增强。',

    // Settings - Background
    'settings.bg_removal': '背景去除',
    'settings.auto_remove_bg': '自动去除背景',
    'settings.bg_hint': '检测边缘主色并以透明色填充。',

    // Settings - Dithering
    'settings.dithering': '抖动处理',
    'settings.enable_dithering': '启用 Floyd-Steinberg 抖动',
    'settings.dithering_hint': '产生更平滑的颜色过渡，但处理时间更长',

    // Buttons
    'btn.generate': '生成图案',
    'btn.edit': '编辑',
    'btn.exit_edit': '退出编辑',
    'btn.export_png': '导出 PNG',
    'btn.export_pdf': '导出 PDF',

    // Result
    'result.empty': '上传图片并生成拼豆图案',
    'result.colors_used': '使用的颜色',
    'result.colors_total': '{colors} 种颜色, 共 {beads} 颗珠子',

    // Examples
    'examples.title': '示例图片',

    // Toast messages
    'toast.upload_type_error': '请上传图片文件 (JPG, PNG, GIF, WEBP)',
    'toast.upload_size_error': '文件大小超过 20MB 限制',
    'toast.upload_first': '请先上传图片',
    'toast.processing': '处理中...',
    'toast.pattern_result': '图案: {w}x{h}, {c} 种颜色',
    'toast.timeout': '处理超时，请尝试降低分辨率。',
    'toast.update_failed': '更新单元格失败',
    'toast.png_success': 'PNG 导出成功',
    'toast.png_failed': 'PNG 导出失败',
    'toast.pdf_success': 'PDF 导出成功',
    'toast.pdf_failed': 'PDF 导出失败',
    'toast.example_loaded': '示例图片已加载',
    'toast.example_load_error': '加载示例图片失败',

    // Slider values
    'value.auto': '自动',
    'value.off': '关闭',

    // Serial port
    'btn.send_esp32': '发送到 ESP32',
    'serial.title': '发送到 ESP32',
    'serial.port': '串口:',
    'serial.baud_rate': '波特率:',
    'serial.bg_color': '背景色 (透明区域):',
    'serial.scanning': '扫描中...',
    'serial.no_ports': '未找到串口',
    'serial.scan_failed': '扫描失败',
    'serial.refresh': '刷新',
    'serial.send': '发送',
    'serial.sending': '正在发送...',
    'serial.success': '发送成功! {bytes} 字节, 耗时 {ms}ms',
    'serial.error': '错误: {msg}',
    'serial.select_port': '请选择串口',
    'serial.send_success': '已发送到 ESP32',
    'serial.esp32_log': 'ESP32 日志:',
    'serial.clear': '清除',
    'btn.cancel': '取消',
    'toast.generate_first': '请先生成图案',

    // BLE/WiFi Connection
    'ble.connection_mode': '连接模式: {mode}',
    'wifi.scan_results_placeholder': '扫描到的热点会显示在这里',
    'wifi.signal': '信号',
    'wifi.scan_hotspots': '扫描热点',
    'wifi.connect_uuid': '连接 UUID',
    'wifi.scan_hint': '先扫描设备二维码或手动输入 UUID，然后由 ESP32 扫描附近热点',
    'qr.scan_hint': '请将二维码放入取景框内，扫描后将优先连接对应设备',
    'ble.scan_nearby': '扫描附近热点',
    'ble.connect_esp32': '连接这台 ESP32',
    'ble.target_locked': '目标设备 {uuid} 已锁定。点一下即可{mode}。',
    'ble.connecting_to': '正在连接 {uuid}{mode}',
    'ble.no_device': '未选择蓝牙设备',
    'ble.connect_failed': '蓝牙连接失败',
    'qr.invalid_content': '二维码内容不是有效链接或 UUID',
    'uuid.invalid': 'UUID 无效',
    'camera.unavailable': '当前浏览器无法直接调用摄像头，请使用下方拍照识别',
    'qr.scan_device_first': '请先扫描设备二维码或输入设备 UUID',
    'wifi.scan_failed': '热点扫描失败',
    'qr.recognizing': '正在识别图片中的二维码..',
    'qr.recognize_failed': '图片识别失败，请重试',
    'ble.connecting_scan': '正在连接 {uuid} 并扫描附近热点..',
    'esp32.scanning': 'ESP32 正在扫描附近热点...',
    'wifi.no_results': '未扫描到可用热点',
    'wifi.found_count': '已扫描到 {count} 个热点',
    'wifi.returned_results': '设备 {uuid} 已返回 {count} 个热点，请继续选择联网方式。',
    'wifi.no_hotspots': '设备 {uuid} 未扫描到热点，请确认附近路由器已开启。',
    'wifi.select_first': '请先选择一个 WiFi 热点',
    'wifi.enter_password': '请输入 WiFi 密码',
    'wifi.connecting': '正在让 ESP32 连接 {ssid}...',
    'wifi.connected': 'ESP32 已接入 WiFi: {ssid}',
    'wifi.connect_failed': 'ESP32 连接 WiFi 失败',
    'wifi.auto_scanning': '蓝牙已连接，正在自动扫描 WiFi 热点...',
    'wifi.scan_failed': 'WiFi 扫描失败',
    'wifi.device_not_registered': '设备 {uuid} 尚未注册到 WiFi 中继，请先让设备接入同一网络',
    'wifi.timeout': '设备 {uuid} ({ip}) 连接超时，设备可能离线',
    'wifi.unreachable': '设备 {uuid} ({ip}) 无法连接，请检查网络',
    'ble.device_connected': '已连接设备：{uuid}',
    'ble.header_connected': '已连接 {uuid}',
    'ble.target_device': '目标 {uuid}',
    'ble.saved_device': '已记住设备：{uuid}',
    'ble.saved_device_hint': '已记住设备 {uuid}。点击“连接设备”可重新通过蓝牙连接，WiFi 将作为这台设备的备选发送路径。',
    'ble.page_locked': '当前页面已锁定目标设备：{uuid}。点击"连接设备"后，浏览器会只显示这台 ESP32。',
    'ble.reconnect': '重新连接设备',
    'ble.connect_target': '连接 {uuid}',
    'ble.connect_device': '连接设备',
    'ble.no_device_hint': '未记住设备。点击“连接设备”从浏览器蓝牙列表中选择你的 ESP32。',
    'ble.bluetooth_unavailable': '当前浏览器不支持蓝牙',
    'ble.remembered_device': '已记住设备 {uuid}',
    'ble.choose_device': '点击连接后选择设备',
    'ble.tap_to_connect': '点击连接设备 {uuid}',
    'ble.tap_hint_detail': '点击后浏览器会显示蓝牙设备列表',
    'ble.scan_to_pair': '先扫描设备二维码进行配对',
    'ble.scan_hint_detail': '已配对后可继续上传图片；也可在设置中切换 WiFi 模式',
    'upload.click_hint': '点击上传图片',
    'esp32.wifi_scan_failed': 'ESP32 WiFi 扫描失败',
    'wifi.scan_timeout': 'WiFi 扫描超时',
    'ble.locked_scan_hint': '已锁定设备 {uuid}。请在扫码弹窗中连接该设备并扫描附近热点。',
    'wifi.select_device_hint': '请先通过蓝牙连接设备',
    'wifi.target_locked_scan': '当前已记住设备：{uuid}，WiFi 将作为这台设备的备选发送路径。',
    'wifi.no_saved_device': '请先通过蓝牙连接设备，才能使用 WiFi 备选模式',
    'brightness.label': '屏幕亮度：',
    'brightness.hint_connected': '拖动后会立即同步到当前设备',
    'brightness.hint_disconnected': '请先连接设备后再同步亮度',

    // WiFi connection panel
    'wifi.selected_network': '已选择: {ssid}',
    'wifi.password_for': '输入 {ssid} 的密码',
    'wifi.connect_with_password': '连接 WiFi',
    'wifi.connect_open': '连接开放网络',
    'wifi.secured': '加密',
    'wifi.open': '开放',

    // Connection mode labels
    'ble.mode_ble': '蓝牙',
    'ble.mode_serial': '串口',
    'ble.mode_default': '模式',

    // Additional toast messages
    'toast.uuid_format': 'UUID 必须是 12 位十六进制字符',
    'toast.browser_no_qr': '当前浏览器不支持二维码扫描',
    'toast.qr_unavailable': '当前环境无法使用二维码扫描组件',
    'toast.ble_disconnected': '蓝牙已断开',
    'toast.ble_not_ready': '蓝牙连接未就绪',
    'toast.wifi_credentials_long': 'WiFi SSID 或密码过长',

    // More toast messages
    'toast.json_export_success': 'JSON 导出成功',
    'toast.json_export_failed': 'JSON 导出失败',
    'toast.ble_uuid_mismatch': '选择了 {selected}，但目标是 {expected}',
    'toast.ble_connected': '蓝牙已连接: {uuid}',
    'toast.ble_connected_simple': '蓝牙已连接',
    'toast.brightness_sync_failed': '亮度同步失败',
  },

  en: {
    // Header
    'header.api_docs': 'API Docs',

    // Upload
    'upload.drop_hint': 'Drop image here or click to upload',
    'upload.format_hint': 'JPG, PNG, GIF, WEBP (max 20MB)',

    // Settings - Palette
    'settings.palette_preset': 'Palette Preset',

    // Settings - Grid
    'settings.board_size': 'Bead Board Size',
    'settings.fixed_grid': 'Fixed Grid',
    'settings.pixel_block': 'Pixel Block Size',
    'settings.pixel_block_label': 'Pixel block size:',
    'grid.small': 'pegs (small)',
    'grid.1board': 'pegs (1 board)',
    'grid.default': 'pegs',
    'grid.2x2': 'pegs (2x2 boards)',
    'grid.3x3': 'pegs (3x3 boards)',

    // Settings - Color
    'settings.color_controls': 'Color Controls',
    'settings.max_colors': 'Max colors:',
    'settings.max_colors_hint': '0 = unlimited (auto). Drag to limit the number of colors used.',
    'settings.merge_threshold': 'Color merge threshold:',
    'settings.merge_hint': 'Merge similar colors to reduce total count. Higher = more merging.',

    // Settings - Adjustments
    'settings.image_adjustments': 'Image Adjustments',
    'settings.contrast': 'Contrast:',
    'settings.saturation': 'Saturation:',
    'settings.sharpness': 'Sharpness:',
    'settings.adjust_hint': '0 = auto-detect. Drag left to reduce, right to boost.',

    // Settings - Background
    'settings.bg_removal': 'Background Removal',
    'settings.auto_remove_bg': 'Auto remove background',
    'settings.bg_hint': 'Detects the dominant border color and flood-fills it as transparent.',

    // Settings - Dithering
    'settings.dithering': 'Dithering',
    'settings.enable_dithering': 'Enable Floyd-Steinberg dithering',
    'settings.dithering_hint': 'Produces smoother color transitions but takes longer',

    // Buttons
    'btn.generate': 'Generate Pattern',
    'btn.edit': 'Edit',
    'btn.exit_edit': 'Exit Edit',
    'btn.export_png': 'Export PNG',
    'btn.export_pdf': 'Export PDF',

    // Result
    'result.empty': 'Upload an image and generate a pattern',
    'result.colors_used': 'Colors Used',
    'result.colors_total': '{colors} colors, {beads} beads total',

    // Examples
    'examples.title': 'Example Images',

    // Toast messages
    'toast.upload_type_error': 'Please upload an image file (JPG, PNG, GIF, WEBP)',
    'toast.upload_size_error': 'File size exceeds 20MB limit',
    'toast.upload_first': 'Please upload an image first',
    'toast.processing': 'Processing...',
    'toast.pattern_result': 'Pattern: {w}x{h}, {c} colors',
    'toast.timeout': 'Processing timeout. Try reducing resolution.',
    'toast.update_failed': 'Failed to update cell',
    'toast.png_success': 'PNG exported successfully',
    'toast.png_failed': 'PNG export failed',
    'toast.pdf_success': 'PDF exported successfully',
    'toast.pdf_failed': 'PDF export failed',
    'toast.example_loaded': 'Example image loaded',
    'toast.example_load_error': 'Failed to load example image',

    // Slider values
    'value.auto': 'Auto',
    'value.off': 'Off',

    // Serial port
    'btn.send_esp32': 'Send to ESP32',
    'serial.title': 'Send to ESP32',
    'serial.port': 'Serial Port:',
    'serial.baud_rate': 'Baud Rate:',
    'serial.bg_color': 'Background Color (transparent areas):',
    'serial.scanning': 'Scanning...',
    'serial.no_ports': 'No ports found',
    'serial.scan_failed': 'Scan failed',
    'serial.refresh': 'Refresh',
    'serial.send': 'Send',
    'serial.sending': 'Sending...',
    'serial.success': 'Success! {bytes} bytes sent in {ms}ms',
    'serial.error': 'Error: {msg}',
    'serial.select_port': 'Please select a port',
    'serial.send_success': 'Sent to ESP32',
    'serial.esp32_log': 'ESP32 Log:',
    'serial.clear': 'Clear',
    'btn.cancel': 'Cancel',
    'toast.generate_first': 'Please generate a pattern first',

    // BLE/WiFi Connection
    'ble.connection_mode': 'Connection mode: {mode}',
    'wifi.scan_results_placeholder': 'Scanned hotspots will appear here',
    'wifi.signal': 'Signal',
    'wifi.scan_hotspots': 'Scan Hotspots',
    'wifi.connect_uuid': 'Connect UUID',
    'wifi.scan_hint': 'Scan device QR or enter UUID, then ESP32 scans nearby hotspots',
    'qr.scan_hint': 'Point camera at QR code to scan and connect',
    'ble.scan_nearby': 'Scan nearby hotspots',
    'ble.connect_esp32': 'Connect this ESP32',
    'ble.target_locked': 'Target device {uuid} locked. Tap to {mode}.',
    'ble.connecting_to': 'Connecting to {uuid}{mode}',
    'ble.no_device': 'No BLE device selected',
    'ble.connect_failed': 'BLE connection failed',
    'qr.invalid_content': 'QR code is not a valid link or UUID',
    'uuid.invalid': 'Invalid UUID',
    'camera.unavailable': 'Camera unavailable, use photo upload below',
    'qr.scan_device_first': 'Please scan device QR or enter UUID first',
    'wifi.scan_failed': 'Hotspot scan failed',
    'qr.recognizing': 'Recognizing QR code from image..',
    'qr.recognize_failed': 'Image recognition failed, please retry',
    'ble.connecting_scan': 'Connecting to {uuid} and scanning hotspots..',
    'esp32.scanning': 'ESP32 is scanning nearby hotspots...',
    'wifi.no_results': 'No hotspots found',
    'wifi.found_count': 'Found {count} hotspots',
    'wifi.returned_results': 'Device {uuid} returned {count} hotspots. Select one to connect.',
    'wifi.no_hotspots': 'Device {uuid} found no hotspots. Check if router is on.',
    'wifi.select_first': 'Please select a WiFi hotspot first',
    'wifi.enter_password': 'Please enter WiFi password',
    'wifi.connecting': 'ESP32 is connecting to {ssid}...',
    'wifi.connected': 'ESP32 connected to WiFi: {ssid}',
    'wifi.connect_failed': 'ESP32 WiFi connection failed',
    'wifi.auto_scanning': 'Bluetooth connected, auto-scanning WiFi hotspots...',
    'wifi.scan_failed': 'WiFi scan failed',
    'wifi.device_not_registered': 'Device {uuid} is not registered to the WiFi relay yet. Bring it onto the same network first.',
    'wifi.timeout': 'Device {uuid} ({ip}) connection timeout, device may be offline',
    'wifi.unreachable': 'Device {uuid} ({ip}) unreachable, please check network',
    'ble.device_connected': 'Connected device: {uuid}',
    'ble.header_connected': 'Connected {uuid}',
    'ble.target_device': 'Target {uuid}',
    'ble.saved_device': 'Remembered device: {uuid}',
    'ble.saved_device_hint': 'Device {uuid} is remembered. Click "Connect device" to reconnect over Bluetooth. WiFi stays as a backup send path for this device.',
    'ble.page_locked': 'Page locked to device {uuid}. Click "Connect" to show only this ESP32.',
    'ble.reconnect': 'Reconnect device',
    'ble.connect_target': 'Connect {uuid}',
    'ble.connect_device': 'Connect device',
    'ble.no_device_hint': 'No remembered device. Click "Connect device" and choose your ESP32 from the browser Bluetooth list.',
    'ble.bluetooth_unavailable': 'Web Bluetooth unavailable',
    'ble.remembered_device': 'Remembered device {uuid}',
    'ble.choose_device': 'Click connect to choose device',
    'ble.tap_to_connect': 'Tap to connect device {uuid}',
    'ble.tap_hint_detail': 'Browser will show Bluetooth device list',
    'ble.scan_to_pair': 'Scan device QR code to pair first',
    'ble.scan_hint_detail': 'After pairing, upload images; or switch to WiFi mode in settings',
    'upload.click_hint': 'Click to upload image',
    'esp32.wifi_scan_failed': 'ESP32 WiFi scan failed',
    'wifi.scan_timeout': 'WiFi scan timeout',
    'ble.locked_scan_hint': 'Device {uuid} locked. Connect and scan hotspots in scanner popup.',
    'wifi.select_device_hint': 'Connect over Bluetooth first',
    'wifi.target_locked_scan': 'Remembered device: {uuid}. WiFi will be used as a backup send path for this device.',
    'wifi.no_saved_device': 'Connect over Bluetooth first before using WiFi backup mode',
    'brightness.label': 'Display brightness:',
    'brightness.hint_connected': 'Drag to sync brightness to the current device immediately',
    'brightness.hint_disconnected': 'Connect a device before syncing brightness',

    // WiFi connection panel
    'wifi.selected_network': 'Selected: {ssid}',
    'wifi.password_for': 'Enter password for {ssid}',
    'wifi.connect_with_password': 'Connect WiFi',
    'wifi.connect_open': 'Connect Open Network',
    'wifi.secured': 'Secured',
    'wifi.open': 'Open',

    // Connection mode labels
    'ble.mode_ble': 'BLE',
    'ble.mode_serial': 'Serial',
    'ble.mode_default': 'Mode',

    // Additional toast messages
    'toast.uuid_format': 'UUID must be 12 hexadecimal characters',
    'toast.browser_no_qr': 'Current browser does not support QR scanning',
    'toast.qr_unavailable': 'QR scanning component is unavailable in current environment',
    'toast.ble_disconnected': 'Bluetooth disconnected',
    'toast.ble_not_ready': 'Bluetooth connection is not ready',
    'toast.wifi_credentials_long': 'WiFi SSID or password is too long',

    // More toast messages
    'toast.json_export_success': 'JSON exported successfully',
    'toast.json_export_failed': 'JSON export failed',
    'toast.ble_uuid_mismatch': 'Selected {selected}, but expected {expected}',
    'toast.ble_connected': 'Bluetooth connected: {uuid}',
    'toast.ble_connected_simple': 'Bluetooth connected',
    'toast.brightness_sync_failed': 'Brightness sync failed',
  }
};

// Current language (default: zh)
let currentLang = localStorage.getItem('beadcraft_lang') || 'zh';

// Get translated string, with optional template variables
function t(key, vars) {
  const str = (I18N[currentLang] && I18N[currentLang][key]) || (I18N['en'] && I18N['en'][key]) || key;
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{${k}}`);
}

// Apply translations to all elements with data-i18n attribute
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translated = t(key);
    // For input elements, set placeholder; for others, set textContent
    if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio') {
      el.placeholder = translated;
    } else {
      el.textContent = translated;
    }
  });

  // Update grid size options
  updateGridOptions();

  // Update dynamic slider labels
  updateSliderLabels();
}

// Update grid select options with translated text
function updateGridOptions() {
  const select = document.getElementById('grid-size-select');
  if (!select) return;
  const options = select.options;
  const gridTexts = {
    '15x15': `15 x 15 ${t('grid.small')}`,
    '29x29': `29 x 29 ${t('grid.1board')}`,
    '32x32': `32 x 32 ${t('grid.default')}`,
    '48x48': `48 x 48 ${t('grid.default')}`,
    '58x58': `58 x 58 ${t('grid.2x2')}`,
    '64x64': `64 x 64 ${t('grid.default')}`,
    '87x87': `87 x 87 ${t('grid.3x3')}`,
    '96x96': `96 x 96 ${t('grid.default')}`,
  };
  for (let i = 0; i < options.length; i++) {
    const val = options[i].value;
    if (gridTexts[val]) {
      options[i].textContent = gridTexts[val];
    }
  }
}

// Re-apply slider value labels after language switch
function updateSliderLabels() {
  const maxSlider = document.getElementById('max-colors-slider');
  if (maxSlider) {
    const v = parseInt(maxSlider.value);
    document.getElementById('max-colors-value').textContent = v === 0 ? t('value.auto') : v;
  }

  const simSlider = document.getElementById('similarity-slider');
  if (simSlider) {
    const v = parseInt(simSlider.value);
    document.getElementById('similarity-value').textContent = v === 0 ? t('value.off') : v;
  }

  ['contrast', 'saturation', 'sharpness'].forEach(name => {
    const slider = document.getElementById(`${name}-slider`);
    const display = document.getElementById(`${name}-value`);
    if (slider && display) {
      const v = parseInt(slider.value);
      display.textContent = v === 0 ? t('value.auto') : (v > 0 ? '+' + v : v);
    }
  });
}

// Switch language
function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('beadcraft_lang', lang);
  applyTranslations();

  // Update language switcher button states
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  // Re-render color panel if data exists
  if (window.appState && window.appState.colorSummary && window.appState.colorSummary.length > 0) {
    if (typeof renderColorPanel === 'function') renderColorPanel();
  }

  // Update generate button text (if not processing)
  const genBtn = document.getElementById('generate-btn');
  if (genBtn && !genBtn.disabled) {
    genBtn.textContent = t('btn.generate');
  }

  // Update edit toggle button
  const editBtn = document.getElementById('edit-toggle');
  if (editBtn) {
    editBtn.textContent = window.appState && window.appState.editMode ? t('btn.exit_edit') : t('btn.edit');
  }
}
