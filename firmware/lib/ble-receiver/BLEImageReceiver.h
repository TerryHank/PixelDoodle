#pragma once
#include <Arduino.h>
#include <time.h>
#include <functional>
#include <Preferences.h>
#include <NimBLEDevice.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <mbedtls/md.h>

// BLE Service UUID (custom for BeadCraft)
#define SERVICE_UUID           "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID    "beb5483e-36e1-4688-b7f5-ea0734b3e6c1"

const uint16_t IMAGE_SIZE = 8192;  // 64x64 * 2 bytes
const uint8_t MAX_HIGHLIGHT_COLORS = 16;
#ifndef BEADCRAFT_TRANSPARENT_RGB565_DEFINED
const uint16_t TRANSPARENT_RGB565 = 0x0001;
#define BEADCRAFT_TRANSPARENT_RGB565_DEFINED
#endif

// Packet types
#define PKT_START_IMAGE    0x01
#define PKT_IMAGE_DATA     0x02
#define PKT_END_IMAGE      0x03
#define PKT_HIGHLIGHT      0x04
#define PKT_SHOW_ALL       0x05
#define PKT_SET_BRIGHTNESS 0x09
#define PKT_GET_BRIGHTNESS 0x0A
#define PKT_ACTIVATION_START  0x0B
#define PKT_ACTIVATION_DATA   0x0C
#define PKT_ACTIVATION_COMMIT 0x0D
#define PKT_GET_LOCK_STATUS   0x0E

#define NTF_BRIGHTNESS      0x26
#define NTF_ACTIVATION_STATUS 0x27

#define ACTIVATION_LOCKED          0x00
#define ACTIVATION_UNLOCKED        0x01
#define ACTIVATION_MALFORMED       0x02
#define ACTIVATION_WRONG_DEVICE    0x03
#define ACTIVATION_INVALID_SIG     0x04
#define ACTIVATION_REPLAYED        0x05
#define ACTIVATION_SECRET_MISSING  0x06
#define ACTIVATION_EXPIRED         0x07

#ifndef BEADCRAFT_DEVICE_LOCK_ENABLED
#define BEADCRAFT_DEVICE_LOCK_ENABLED 1
#endif

// Provision this per device. An empty value deliberately fails closed.
#ifndef BEADCRAFT_DEVICE_SECRET
#define BEADCRAFT_DEVICE_SECRET ""
#endif

const uint8_t DEVICE_GRANT_VERSION = 2;
const size_t DEVICE_GRANT_BODY_SIZE = 35;
const size_t DEVICE_GRANT_SIGNATURE_SIZE = 16;
const size_t DEVICE_GRANT_SIZE = DEVICE_GRANT_BODY_SIZE + DEVICE_GRANT_SIGNATURE_SIZE;
const uint32_t DEVICE_GRANT_MIN_SECONDS = 30;
const uint32_t DEVICE_GRANT_MAX_SECONDS = 3600;
const uint64_t DEVICE_GRANT_MIN_VALID_EPOCH = 1700000000ULL;

class BLEImageReceiver : public NimBLEServerCallbacks, public NimBLECharacteristicCallbacks {
private:
    MatrixPanel_I2S_DMA* _display;
    
    // Image storage (persistent)
    uint8_t _imageBuffer[IMAGE_SIZE];
    bool _hasImage;
    
    // Highlight state
    uint16_t _highlightColors[MAX_HIGHLIGHT_COLORS];
    uint8_t _highlightCount;
    bool _highlightMode;
    std::function<void(uint8_t, bool)> _setBrightness;
    std::function<uint8_t(void)> _getBrightness;
    std::function<void(void)> _showLockedScreen;
    
    // BLE state
    size_t _recvIndex;
    uint16_t _recvChecksum;
    bool _deviceConnected;
    NimBLEServer* _pServer;
    NimBLECharacteristic* _pCharacteristic;
    bool _loading;
    uint8_t _loadingFrame;
    unsigned long _lastLoadingAnimMs;
    String _deviceCode;
    uint8_t _grantBuffer[DEVICE_GRANT_SIZE];
    size_t _grantExpected;
    size_t _grantReceived;
    unsigned long _unlockedUntilMs;
    bool _wasUnlocked;
    Preferences _accessPreferences;

    bool isUnlockedNow() {
#if BEADCRAFT_DEVICE_LOCK_ENABLED
        if (_unlockedUntilMs == 0) return false;
        return static_cast<int32_t>(_unlockedUntilMs - millis()) > 0;
#else
        return true;
#endif
    }

    void sendActivationStatus(uint8_t status) {
        if (!_pCharacteristic || !_deviceConnected) return;
        uint8_t payload[] = {NTF_ACTIVATION_STATUS, status};
        _pCharacteristic->setValue(payload, sizeof(payload));
        _pCharacteristic->notify(true);
        delay(12);
    }

    void showLockedScreen() {
        _loading = false;
        _recvIndex = 0;
        if (_showLockedScreen) {
            _showLockedScreen();
        } else {
            _display->fillScreen(0);
        }
    }

    bool requireUnlocked() {
        if (isUnlockedNow()) return true;
        _unlockedUntilMs = 0;
        _wasUnlocked = false;
        showLockedScreen();
        sendActivationStatus(ACTIVATION_LOCKED);
        Serial.println("BLE: Rejected while device locked");
        return false;
    }

    int8_t hexNibble(char value) const {
        if (value >= '0' && value <= '9') return value - '0';
        if (value >= 'A' && value <= 'F') return 10 + value - 'A';
        if (value >= 'a' && value <= 'f') return 10 + value - 'a';
        return -1;
    }

    bool grantMatchesDevice(const uint8_t* grantDevice) const {
        if (_deviceCode.length() != 12) return false;
        for (size_t i = 0; i < 6; i++) {
            const int8_t high = hexNibble(_deviceCode.charAt(i * 2));
            const int8_t low = hexNibble(_deviceCode.charAt(i * 2 + 1));
            if (high < 0 || low < 0 || grantDevice[i] != ((high << 4) | low)) {
                return false;
            }
        }
        return true;
    }

    uint32_t readLittleEndian32(const uint8_t* value) const {
        return static_cast<uint32_t>(value[0]) |
            (static_cast<uint32_t>(value[1]) << 8) |
            (static_cast<uint32_t>(value[2]) << 16) |
            (static_cast<uint32_t>(value[3]) << 24);
    }

    uint64_t readLittleEndian64(const uint8_t* value) const {
        uint64_t result = 0;
        for (size_t i = 0; i < 8; i++) {
            result |= static_cast<uint64_t>(value[i]) << (i * 8);
        }
        return result;
    }

    uint64_t storedGrantSequence() {
        uint8_t encoded[8] = {0};
        if (_accessPreferences.getBytesLength("grantSeq") != sizeof(encoded)) {
            return 0;
        }
        if (_accessPreferences.getBytes("grantSeq", encoded, sizeof(encoded)) !=
            sizeof(encoded)) {
            return UINT64_MAX;
        }
        return readLittleEndian64(encoded);
    }

    bool persistGrantSequence(uint64_t sequence) {
        uint8_t encoded[8] = {0};
        for (size_t i = 0; i < sizeof(encoded); i++) {
            encoded[i] = static_cast<uint8_t>((sequence >> (i * 8)) & 0xFF);
        }
        return _accessPreferences.putBytes("grantSeq", encoded, sizeof(encoded)) ==
            sizeof(encoded);
    }

    bool signatureValid() const {
        const char* secret = BEADCRAFT_DEVICE_SECRET;
        if (strlen(secret) < 16) return false;
        const mbedtls_md_info_t* mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
        if (!mdInfo) return false;
        uint8_t digest[32] = {0};
        if (mbedtls_md_hmac(
                mdInfo,
                reinterpret_cast<const unsigned char*>(secret),
                strlen(secret),
                _grantBuffer,
                DEVICE_GRANT_BODY_SIZE,
                digest
            ) != 0) {
            return false;
        }
        uint8_t difference = 0;
        for (size_t i = 0; i < DEVICE_GRANT_SIGNATURE_SIZE; i++) {
            difference |= digest[i] ^ _grantBuffer[DEVICE_GRANT_BODY_SIZE + i];
        }
        return difference == 0;
    }

    void commitActivationGrant() {
#if !BEADCRAFT_DEVICE_LOCK_ENABLED
        sendActivationStatus(ACTIVATION_UNLOCKED);
        return;
#endif
        if (_grantExpected != DEVICE_GRANT_SIZE || _grantReceived != DEVICE_GRANT_SIZE ||
            _grantBuffer[0] != DEVICE_GRANT_VERSION) {
            sendActivationStatus(ACTIVATION_MALFORMED);
            return;
        }
        if (!grantMatchesDevice(_grantBuffer + 1)) {
            sendActivationStatus(ACTIVATION_WRONG_DEVICE);
            return;
        }
        if (strlen(BEADCRAFT_DEVICE_SECRET) < 16) {
            sendActivationStatus(ACTIVATION_SECRET_MISSING);
            Serial.println("BLE: BEADCRAFT_DEVICE_SECRET is not provisioned");
            return;
        }
        if (!signatureValid()) {
            sendActivationStatus(ACTIVATION_INVALID_SIG);
            return;
        }
        const uint32_t duration = readLittleEndian32(_grantBuffer + 7);
        if (duration < DEVICE_GRANT_MIN_SECONDS || duration > DEVICE_GRANT_MAX_SECONDS) {
            sendActivationStatus(ACTIVATION_MALFORMED);
            return;
        }
        const uint64_t notAfterEpoch = readLittleEndian64(_grantBuffer + 11);
        if (notAfterEpoch < DEVICE_GRANT_MIN_VALID_EPOCH) {
            sendActivationStatus(ACTIVATION_MALFORMED);
            return;
        }
        const time_t nowEpoch = time(nullptr);
        if (nowEpoch >= static_cast<time_t>(DEVICE_GRANT_MIN_VALID_EPOCH) &&
            static_cast<uint64_t>(nowEpoch) >= notAfterEpoch) {
            sendActivationStatus(ACTIVATION_EXPIRED);
            return;
        }
        const uint64_t grantSequence = readLittleEndian64(_grantBuffer + 19);
        const uint64_t highWater = storedGrantSequence();
        if (grantSequence == 0 || highWater == UINT64_MAX) {
            sendActivationStatus(ACTIVATION_MALFORMED);
            return;
        }
        if (grantSequence == highWater && isUnlockedNow()) {
            // BLE retransmission ACK only: never extend the original unlock deadline.
            sendActivationStatus(ACTIVATION_UNLOCKED);
            return;
        }
        if (grantSequence <= highWater) {
            sendActivationStatus(ACTIVATION_REPLAYED);
            return;
        }
        if (!persistGrantSequence(grantSequence)) {
            sendActivationStatus(ACTIVATION_MALFORMED);
            return;
        }
        _unlockedUntilMs = millis() + duration * 1000UL;
        _wasUnlocked = true;
        sendActivationStatus(ACTIVATION_UNLOCKED);
        Serial.printf("BLE: Device unlocked for %lu seconds\n", static_cast<unsigned long>(duration));
    }

    uint16_t rgbTo565(uint8_t r, uint8_t g, uint8_t b) {
        return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
    }

    void drawLoadingSpinner(bool force = false) {
        if (!_loading) return;
        const unsigned long now = millis();
        if (!force && now - _lastLoadingAnimMs < 90) return;
        _lastLoadingAnimMs = now;

        static const int8_t dx[8] = {0, 5, 8, 5, 0, -5, -8, -5};
        static const int8_t dy[8] = {-8, -5, 0, 5, 8, 5, 0, -5};
        const int cx = 32;
        const int cy = 32;
        const uint16_t dim = rgbTo565(20, 28, 40);
        const uint16_t mid = rgbTo565(0, 110, 180);
        const uint16_t bright = rgbTo565(0, 220, 255);

        _display->fillScreen(0);
        for (int i = 0; i < 8; i++) {
            const int x = cx + dx[i];
            const int y = cy + dy[i];
            uint16_t color = dim;
            if (i == _loadingFrame) color = bright;
            else if (i == ((_loadingFrame + 7) % 8)) color = mid;
            _display->drawPixel(x, y, color);
            _display->drawPixel(x + 1, y, color);
            _display->drawPixel(x, y + 1, color);
            _display->drawPixel(x + 1, y + 1, color);
        }
        _loadingFrame = (_loadingFrame + 1) % 8;
    }

    void sendCodeNotification(uint8_t code) {
        uint8_t payload[] = {code};
        _pCharacteristic->setValue(payload, 1);
        _pCharacteristic->notify(true);
        delay(12);
    }

    uint8_t readBrightness() const {
        return _getBrightness ? _getBrightness() : 64;
    }

    void sendBrightnessNotification() {
        if (!_pCharacteristic || !_deviceConnected) return;
        uint8_t payload[] = {NTF_BRIGHTNESS, readBrightness()};
        _pCharacteristic->setValue(payload, sizeof(payload));
        _pCharacteristic->notify(true);
        delay(12);
    }

    void sendTextNotification(uint8_t code, const String& text) {
        const size_t maxChunk = 19;
        for (size_t offset = 0; offset < text.length(); offset += maxChunk) {
            const String chunk = text.substring(offset, offset + maxChunk);
            uint8_t payload[20];
            payload[0] = code;
            memcpy(payload + 1, chunk.c_str(), chunk.length());
            _pCharacteristic->setValue(payload, chunk.length() + 1);
            _pCharacteristic->notify(true);
            delay(12);
        }
    }

public:
    BLEImageReceiver(
        MatrixPanel_I2S_DMA* display,
        std::function<void(uint8_t, bool)> setBrightness,
        std::function<uint8_t(void)> getBrightness,
        std::function<void(void)> showLockedScreen
    ) : _display(display), _setBrightness(setBrightness), _getBrightness(getBrightness),
        _showLockedScreen(showLockedScreen) {
        _hasImage = false;
        _highlightCount = 0;
        _highlightMode = false;
        _recvIndex = 0;
        _recvChecksum = 0;
        _deviceConnected = false;
        _pServer = nullptr;
        _pCharacteristic = nullptr;
        _loading = false;
        _loadingFrame = 0;
        _lastLoadingAnimMs = 0;
        _grantExpected = 0;
        _grantReceived = 0;
        _unlockedUntilMs = 0;
        _wasUnlocked = false;
        memset(_imageBuffer, 0, IMAGE_SIZE);
        memset(_highlightColors, 0, sizeof(_highlightColors));
        memset(_grantBuffer, 0, sizeof(_grantBuffer));
    }

    void begin(const String& deviceCode) {
        _deviceCode = deviceCode;
        _deviceCode.toUpperCase();
        _accessPreferences.begin("beadaccess", false);
        String bleName = "BeadCraft-" + deviceCode;
        NimBLEDevice::init(bleName.c_str());
        NimBLEDevice::setPower(ESP_PWR_LVL_P9);
        _pServer = NimBLEDevice::createServer();
        _pServer->setCallbacks(this);
        
        NimBLEService* pService = _pServer->createService(SERVICE_UUID);
        _pCharacteristic = pService->createCharacteristic(
            CHARACTERISTIC_UUID,
            NIMBLE_PROPERTY::READ |
            NIMBLE_PROPERTY::WRITE |
            NIMBLE_PROPERTY::NOTIFY
        );
        _pCharacteristic->setCallbacks(this);
        
        pService->start();
        
        NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
        pAdvertising->addServiceUUID(SERVICE_UUID);
        pAdvertising->setScanResponse(true);
        NimBLEDevice::startAdvertising();
        
        Serial.println("BLE Ready");
    }

    void onConnect(NimBLEServer* pServer) override {
        _deviceConnected = true;
        Serial.println("BLE Connected");
        sendBrightnessNotification();
        sendActivationStatus(isUnlockedNow() ? ACTIVATION_UNLOCKED : ACTIVATION_LOCKED);
    };

    void onDisconnect(NimBLEServer* pServer) override {
        _deviceConnected = false;
        Serial.println("BLE Disconnected");
        NimBLEDevice::startAdvertising();
    }

    void onWrite(NimBLECharacteristic *pCharacteristic) override {
        std::string value = pCharacteristic->getValue();
        const uint8_t* data = reinterpret_cast<const uint8_t*>(value.data());
        size_t len = value.length();
        
        if (len == 0) return;
        
        uint8_t packetType = data[0];
        
        switch (packetType) {
            case PKT_ACTIVATION_START:
                _grantReceived = 0;
                _grantExpected = len >= 3 ? (data[1] | (data[2] << 8)) : 0;
                memset(_grantBuffer, 0, sizeof(_grantBuffer));
                if (_grantExpected != DEVICE_GRANT_SIZE) {
                    _grantExpected = 0;
                    sendActivationStatus(ACTIVATION_MALFORMED);
                }
                break;

            case PKT_ACTIVATION_DATA:
                if (_grantExpected == DEVICE_GRANT_SIZE && len > 1 &&
                    _grantReceived + len - 1 <= DEVICE_GRANT_SIZE) {
                    memcpy(_grantBuffer + _grantReceived, data + 1, len - 1);
                    _grantReceived += len - 1;
                } else {
                    _grantExpected = 0;
                    _grantReceived = 0;
                    sendActivationStatus(ACTIVATION_MALFORMED);
                }
                break;

            case PKT_ACTIVATION_COMMIT:
                commitActivationGrant();
                break;

            case PKT_GET_LOCK_STATUS:
                sendActivationStatus(isUnlockedNow() ? ACTIVATION_UNLOCKED : ACTIVATION_LOCKED);
                break;

            case PKT_START_IMAGE:
                if (!requireUnlocked()) break;
                _recvIndex = 0;
                _recvChecksum = 0;
                _loading = true;
                _loadingFrame = 0;
                _lastLoadingAnimMs = 0;
                drawLoadingSpinner(true);
                Serial.println("BLE: Start image");
                break;
                
            case PKT_IMAGE_DATA:
                if (!isUnlockedNow()) break;
                // Data chunk: [0x02][data...]
                if (len > 1 && _recvIndex + len - 1 <= IMAGE_SIZE) {
                    memcpy(_imageBuffer + _recvIndex, data + 1, len - 1);
                    for (size_t i = 1; i < len; i++) {
                        _recvChecksum = (_recvChecksum + data[i]) & 0xFFFF;
                    }
                    _recvIndex += len - 1;
                }
                drawLoadingSpinner();
                break;
                
            case PKT_END_IMAGE: {
                if (!requireUnlocked()) break;
                Serial.printf("BLE: Image done, %d bytes\n", _recvIndex);
                _loading = false;
                uint16_t expectedChecksum = _recvChecksum;
                if (len >= 3) {
                    expectedChecksum = data[1] | (data[2] << 8);
                }
                if (_recvIndex == IMAGE_SIZE && _recvChecksum == expectedChecksum) {
                    _hasImage = true;
                    _highlightMode = false;
                    displayStoredImage();
                    sendAck(true);
                } else {
                    Serial.printf("BLE: CS_ERR %04X != %04X\n", _recvChecksum, expectedChecksum);
                    _display->fillScreen(0);
                    sendAck(false);
                }
                break;
            }
                
            case PKT_HIGHLIGHT:
                if (!requireUnlocked()) break;
                // Highlight: [0x04][count][RGB565...]
                if (len >= 2) {
                    _highlightCount = min(data[1], (uint8_t)MAX_HIGHLIGHT_COLORS);
                    for (int i = 0; i < _highlightCount; i++) {
                        int offset = 2 + i * 2;
                        if (offset + 1 < len) {
                            _highlightColors[i] = data[offset] | (data[offset + 1] << 8);
                        }
                    }
                    _highlightMode = (_highlightCount > 0);
                    Serial.printf("BLE: Highlight %d colors\n", _highlightCount);
                    if (_hasImage) {
                        displayStoredImage();
                    }
                }
                break;
                
            case PKT_SHOW_ALL:
                if (!requireUnlocked()) break;
                // Show all: [0x05]
                _highlightMode = false;
                Serial.println("BLE: Show all");
                if (_hasImage) {
                    displayStoredImage();
                }
                break;

            case PKT_SET_BRIGHTNESS:
                if (len >= 2 && _setBrightness) {
                    _setBrightness(data[1], true);
                    sendBrightnessNotification();
                }
                break;

            case PKT_GET_BRIGHTNESS:
                sendBrightnessNotification();
                break;
        }
    }

    void displayStoredImage() {
        uint16_t bgColor = 0;  // Black
        uint16_t highlightColor = rgbTo565(0, 0, 255);
        _display->clearScreen();
        
        int idx = 0;
        for (int y = 0; y < 64; y++) {
            for (int x = 0; x < 64; x++) {
                uint16_t storedPixel = _imageBuffer[idx] | (_imageBuffer[idx + 1] << 8);
                idx += 2;
                bool transparentPixel = storedPixel == TRANSPARENT_RGB565;
                uint16_t pixel = transparentPixel ? bgColor : storedPixel;
                
                uint16_t displayColor = pixel;
                
                if (_highlightMode) {
                    // Check if this pixel matches any highlight color
                    bool match = false;
                    if (!transparentPixel) {
                        for (int i = 0; i < _highlightCount; i++) {
                            if (storedPixel == _highlightColors[i]) {
                                match = true;
                                break;
                            }
                        }
                    }
                    displayColor = match ? highlightColor : bgColor;
                }
                
                _display->drawPixel(x, y, displayColor);
            }
        }
        Serial.println(_highlightMode ? "Display: Highlighted" : "Display: Full");
    }

    void applyHighlightPacket(const uint8_t* data, size_t len) {
        if (!requireUnlocked()) return;
        if (len == 0) return;
        if (data[0] == PKT_SHOW_ALL) {
            _highlightMode = false;
            if (_hasImage) displayStoredImage();
            return;
        }
        if (data[0] != PKT_HIGHLIGHT || len < 2) return;

        _highlightCount = min(data[1], (uint8_t)MAX_HIGHLIGHT_COLORS);
        for (int i = 0; i < _highlightCount; i++) {
            int offset = 2 + i * 2;
            if (offset + 1 < len) {
                _highlightColors[i] = data[offset] | (data[offset + 1] << 8);
            }
        }
        _highlightMode = (_highlightCount > 0);
        if (_hasImage) displayStoredImage();
    }

    void sendAck(bool success) {
        sendCodeNotification(static_cast<uint8_t>(success ? 0x06 : 0x15));
    }

    bool isConnected() { return _deviceConnected; }
    bool hasImage() { return _hasImage; }
    bool isUnlocked() { return isUnlockedNow(); }
    
    void update() {
        const bool unlocked = isUnlockedNow();
        if (_wasUnlocked && !unlocked) {
            _unlockedUntilMs = 0;
            _wasUnlocked = false;
            showLockedScreen();
            sendActivationStatus(ACTIVATION_LOCKED);
            Serial.println("BLE: Device grant expired; locked");
        }
        if (_loading) {
            drawLoadingSpinner();
        }
    }
};
