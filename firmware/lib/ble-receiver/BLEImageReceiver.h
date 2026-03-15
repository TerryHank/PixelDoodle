#pragma once
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>

// BLE Service UUID (custom for BeadCraft)
#define SERVICE_UUID           "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID    "beb5483e-36e1-4688-b7f5-ea0734b3e6c1"

const uint16_t IMAGE_SIZE = 8192;  // 64x64 * 2 bytes
const uint8_t MAX_HIGHLIGHT_COLORS = 16;

// Packet types
#define PKT_START_IMAGE    0x01
#define PKT_IMAGE_DATA     0x02
#define PKT_END_IMAGE      0x03
#define PKT_HIGHLIGHT      0x04
#define PKT_SHOW_ALL       0x05

class BLEImageReceiver : public BLEServerCallbacks, public BLECharacteristicCallbacks {
private:
    MatrixPanel_I2S_DMA* _display;
    
    // Image storage (persistent)
    uint8_t _imageBuffer[IMAGE_SIZE];
    bool _hasImage;
    
    // Highlight state
    uint16_t _highlightColors[MAX_HIGHLIGHT_COLORS];
    uint8_t _highlightCount;
    bool _highlightMode;
    
    // BLE state
    size_t _recvIndex;
    uint16_t _recvChecksum;
    bool _deviceConnected;
    BLEServer* _pServer;
    BLECharacteristic* _pCharacteristic;
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
    
public:
    BLEImageReceiver(MatrixPanel_I2S_DMA* display) : _display(display) {
        _hasImage = false;
        _highlightCount = 0;
        _highlightMode = false;
        _recvIndex = 0;
        _recvChecksum = 0;
        _deviceConnected = false;
        _loading = false;
        _loadingFrame = 0;
        _lastLoadingAnimMs = 0;
        memset(_imageBuffer, 0, IMAGE_SIZE);
        memset(_highlightColors, 0, sizeof(_highlightColors));
    }

    void begin(const String& deviceCode) {
        String bleName = "BeadCraft-" + deviceCode;
        BLEDevice::init(bleName.c_str());
        _pServer = BLEDevice::createServer();
        _pServer->setCallbacks(this);
        
        BLEService* pService = _pServer->createService(SERVICE_UUID);
        _pCharacteristic = pService->createCharacteristic(
            CHARACTERISTIC_UUID,
            BLECharacteristic::PROPERTY_WRITE |
            BLECharacteristic::PROPERTY_NOTIFY
        );
        _pCharacteristic->addDescriptor(new BLE2902());
        _pCharacteristic->setCallbacks(this);
        
        pService->start();
        
        BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
        pAdvertising->addServiceUUID(SERVICE_UUID);
        pAdvertising->setScanResponse(false);
        pAdvertising->setMinPreferred(0x0);
        BLEDevice::startAdvertising();
        
        Serial.println("BLE Ready");
    }

    void onConnect(BLEServer* pServer) {
        _deviceConnected = true;
        Serial.println("BLE Connected");
    };

    void onDisconnect(BLEServer* pServer) {
        _deviceConnected = false;
        Serial.println("BLE Disconnected");
        BLEDevice::startAdvertising();
    }

    void onWrite(BLECharacteristic *pCharacteristic) {
        uint8_t* data = pCharacteristic->getData();
        size_t len = pCharacteristic->getLength();
        
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
        }
    }

    void displayStoredImage() {
        uint16_t bgColor = 0;  // Black
        
        int idx = 0;
        for (int y = 0; y < 64; y++) {
            for (int x = 0; x < 64; x++) {
                uint16_t pixel = _imageBuffer[idx] | (_imageBuffer[idx + 1] << 8);
                idx += 2;
                
                uint16_t displayColor = pixel;
                
                if (_highlightMode) {
                    // Check if this pixel matches any highlight color
                    bool match = false;
                    for (int i = 0; i < _highlightCount; i++) {
                        if (pixel == _highlightColors[i]) {
                            match = true;
                            break;
                        }
                    }
                    displayColor = match ? pixel : bgColor;
                }
                
                _display->drawPixel(x, y, displayColor);
            }
        }
        Serial.println(_highlightMode ? "Display: Highlighted" : "Display: Full");
    }

    void sendAck(bool success) {
        uint8_t ack[] = {static_cast<uint8_t>(success ? 0x06 : 0x15)};  // ACK or NAK
        _pCharacteristic->setValue(ack, 1);
        _pCharacteristic->notify();
    }

    bool isConnected() { return _deviceConnected; }
    bool hasImage() { return _hasImage; }
    
    void update() {
        if (_loading) {
            drawLoadingSpinner();
        }
    }
};
