/**
 * @file BeadCraftReceiver.h
 * @brief Receives RGB565 image data from serial with highlight support.
 * 
 * Protocol (fixed 64x64):
 * - Image: Header(4B) + Data(8192B) + Checksum(2B)
 * - Highlight: 0x04 + count(1B) + RGB565 colors(N*2B)
 * - Show All: 0x05
 */

#pragma once

#include <Arduino.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include "ChinesePixels.h"

const uint8_t BEADCRAFT_MAGIC[] = {0xBC, 0xD1, 0x32, 0x57};
const uint16_t IMAGE_SIZE = 8192;  // 64x64 * 2 bytes
const uint8_t MAX_HIGHLIGHT_COLORS = 16;

// Packet types
const uint8_t PKT_IMAGE_START = 0xBC;  // First byte of image header
const uint8_t PKT_HIGHLIGHT = 0x04;
const uint8_t PKT_SHOW_ALL = 0x05;

class BeadCraftReceiver {
private:
    MatrixPanel_I2S_DMA* _display;
    
    // Image storage (persistent)
    uint8_t _buffer[IMAGE_SIZE];
    bool _hasImage;
    
    // Highlight state
    uint16_t _highlightColors[MAX_HIGHLIGHT_COLORS];
    uint8_t _highlightCount;
    bool _highlightMode;
    
    // Receive state
    size_t _index;
    uint16_t _checksum;
    bool _headerFound;
    uint8_t _headerIdx;
    
    // Checksum buffer (was incorrectly static)
    uint8_t _csBuf[2];
    int _csIdx;
    
    // RGB565 color helpers
    uint16_t rgbTo565(uint8_t r, uint8_t g, uint8_t b) {
        return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
    }
    
    // Draw a single Chinese character from pixel data
    void drawChar(int x, int y, const uint16_t* charData, uint16_t color) {
        for (int row = 0; row < CHAR_H; row++) {
            uint16_t pixels = charData[row];
            for (int col = 0; col < CHAR_W; col++) {
                if (pixels & (1 << (CHAR_W - 1 - col))) {
                    _display->drawPixel(x + col, y + row, color);
                }
            }
        }
    }
    
    // Draw text string from pre-generated array
    void drawText(const uint16_t text[][CHAR_H], uint8_t numChars, int startX, int startY, uint16_t color) {
        for (int i = 0; i < numChars; i++) {
            drawChar(startX + i * CHAR_W, startY, text[i], color);
        }
    }
    
public:
    BeadCraftReceiver(MatrixPanel_I2S_DMA* display) : _display(display) {
        _hasImage = false;
        _highlightCount = 0;
        _highlightMode = false;
        reset();
    }
    
    void reset() {
        _index = 0;
        _checksum = 0;
        _headerFound = false;
        _headerIdx = 0;
        _csIdx = 0;
    }
    
    // Display welcome text "像素豆绘"
    void displayWelcome() {
        _display->fillScreen(0);
        
        // Colors
        uint16_t purple = rgbTo565(138, 43, 226);   // 紫色
        uint16_t pink = rgbTo565(255, 105, 180);    // 粉色
        uint16_t cyan = rgbTo565(0, 255, 255);      // 青色
        uint16_t white = rgbTo565(255, 255, 255);
        
        // Draw decorative border
        for (int i = 0; i < 3; i++) {
            _display->drawRect(2 + i, 2 + i, 60 - i*2, 60 - i*2, purple);
        }
        
        // Draw center cross lines (separating 4 quadrants)
        for (int i = 0; i < 3; i++) {
            // Vertical line
            _display->drawLine(31 + i, 8, 31 + i, 56, purple);
            // Horizontal line
            _display->drawLine(8, 31 + i, 56, 31 + i, purple);
        }
        
        // Four-grid layout: 2x2 arrangement
        // Each cell is 32x32, char is 16x16, center in each cell
        // Cell positions: (8, 8), (40, 8), (8, 40), (40, 40)
        
        // Top-left: 像
        drawChar(8, 8, WELCOME[0], pink);
        // Top-right: 素
        drawChar(40, 8, WELCOME[1], cyan);
        // Bottom-left: 豆
        drawChar(8, 40, WELCOME[2], white);
        // Bottom-right: 绘
        drawChar(40, 40, WELCOME[3], purple);
    }
    
    // Display upload icon (dashed square with plus)
    void displayUploadIcon() {
        _display->fillScreen(0);
        
        uint16_t gray = rgbTo565(100, 100, 100);
        uint16_t white = rgbTo565(255, 255, 255);
        uint16_t cyan = rgbTo565(0, 200, 255);
        
        // Dashed square border (centered, smaller to fit text)
        int cx = 18;  // (64-28)/2
        int cy = 6;
        int size = 28;
        
        // Draw dashed border
        for (int i = 0; i < size; i += 4) {
            // Top
            if (i + 2 <= size) {
                _display->drawLine(cx + i, cy, cx + i + 1, cy, gray);
                // Bottom
                _display->drawLine(cx + i, cy + size - 1, cx + i + 1, cy + size - 1, gray);
            }
            // Left
            if (i + 2 <= size) {
                _display->drawLine(cx, cy + i, cx, cy + i + 1, gray);
                // Right
                _display->drawLine(cx + size - 1, cy + i, cx + size - 1, cy + i + 1, gray);
            }
        }
        
        // Draw plus sign in center
        int plusX = cx + size/2;
        int plusY = cy + size/2;
        int plusLen = 8;
        
        // Horizontal line of plus
        for (int i = -plusLen/2; i <= plusLen/2; i++) {
            _display->drawPixel(plusX + i, plusY, white);
        }
        // Vertical line of plus
        for (int i = -plusLen/2; i <= plusLen/2; i++) {
            _display->drawPixel(plusX, plusY + i, white);
        }
        
        // Draw "上传图像" text below the icon
        // 4 chars * 16px = 64px, so startX = 0
        int textY = 40;  // Below the upload icon (cy + size + margin)
        
        for (int i = 0; i < UPLOAD_CHARS; i++) {
            drawChar(i * CHAR_W, textY, UPLOAD[i], cyan);
        }
    }
    
    bool hasImage() const { return _hasImage; }
    
    void update() {
        while (Serial.available() > 0) {
            uint8_t b = Serial.read();
            
            // Check for highlight/show_all commands (single byte)
            if (!_headerFound && _headerIdx == 0) {
                if (b == PKT_SHOW_ALL) {
                    _highlightMode = false;
                    Serial.println("SHOW_ALL");
                    if (_hasImage) displayStoredImage();
                    continue;
                }
                if (b == PKT_HIGHLIGHT) {
                    // Highlight command: 0x04 + count + RGB565...
                    receiveHighlight();
                    continue;
                }
            }
            
            // Image protocol
            if (!_headerFound) {
                if (b == BEADCRAFT_MAGIC[_headerIdx]) {
                    _headerIdx++;
                    if (_headerIdx == 4) {
                        _headerFound = true;
                        Serial.println("HDR");
                    }
                } else {
                    _headerIdx = 0;
                }
                continue;
            }
            
            // Receive image data
            if (_index < IMAGE_SIZE) {
                _buffer[_index++] = b;
                _checksum += b;
                
                if (_index == IMAGE_SIZE) {
                    Serial.println("DATA_OK");
                }
                continue;
            }
            
            // Receive checksum
            _csBuf[_csIdx++] = b;
            
            if (_csIdx == 2) {
                uint16_t receivedCS = _csBuf[0] | (_csBuf[1] << 8);
                
                if (receivedCS == _checksum) {
                    Serial.println("CS_OK");
                    _hasImage = true;
                    _highlightMode = false;
                    displayStoredImage();
                } else {
                    Serial.printf("CS_ERR:%04X!=%04X\n", receivedCS, _checksum);
                }
                
                reset();
            }
        }
    }
    
    void receiveHighlight() {
        // Wait for count byte
        while (Serial.available() == 0) delay(1);
        uint8_t count = Serial.read();
        
        _highlightCount = min(count, (uint8_t)MAX_HIGHLIGHT_COLORS);
        
        // Read RGB565 colors
        for (int i = 0; i < _highlightCount; i++) {
            while (Serial.available() < 2) delay(1);
            uint8_t lo = Serial.read();
            uint8_t hi = Serial.read();
            _highlightColors[i] = lo | (hi << 8);
        }
        
        _highlightMode = (_highlightCount > 0);
        Serial.printf("HIGHLIGHT:%d\n", _highlightCount);
        
        if (_hasImage) {
            displayStoredImage();
        }
    }
    
    void displayStoredImage() {
        uint16_t bgColor = 0;  // Black
        
        int idx = 0;
        for (int y = 0; y < 64; y++) {
            for (int x = 0; x < 64; x++) {
                uint16_t pixel = _buffer[idx] | (_buffer[idx + 1] << 8);
                idx += 2;
                
                uint16_t displayColor = pixel;
                
                if (_highlightMode) {
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
        Serial.println(_highlightMode ? "OK_HL" : "OK");
    }
};
