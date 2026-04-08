#pragma once
#include <Arduino.h>
#include <functional>
#include <NimBLEDevice.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>

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

#define NTF_BRIGHTNESS      0x26

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
    
    // BLE state
    size_t _recvIndex;
    uint16_t _recvChecksum;
    bool _deviceConnected;
    NimBLEServer* _pServer;
    NimBLECharacteristic* _pCharacteristic;
    bool _loading;
    uint8_t _loadingFrame;
    unsigned long _lastLoadingAnimMs;

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
        std::function<uint8_t(void)> getBrightness
    ) : _display(display), _setBrightness(setBrightness), _getBrightness(getBrightness) {
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
        memset(_imageBuffer, 0, IMAGE_SIZE);
        memset(_highlightColors, 0, sizeof(_highlightColors));
    }

    void begin(const String& deviceCode) {
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
            case PKT_START_IMAGE:
                _recvIndex = 0;
                _recvChecksum = 0;
                _loading = true;
                _loadingFrame = 0;
                _lastLoadingAnimMs = 0;
                drawLoadingSpinner(true);
                Serial.println("BLE: Start image");
                break;
                
            case PKT_IMAGE_DATA:
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
    
    void update() {
        if (_loading) {
            drawLoadingSpinner();
        }
    }
};
