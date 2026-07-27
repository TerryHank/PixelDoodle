#pragma once

#include <stdint.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>

namespace beadcraft {

// Reference wiring copied from D:\Workspace\PixelDoodle\firmware\tools\hub75-color-test
// while preserving this project's full-color rendering path.
constexpr HUB75_I2S_CFG::i2s_pins kHub75Pins = {
  5,   // R1
  6,   // G1
  7,   // B1
  35,  // R2
  16,  // G2
  17,  // B2
  18,  // A
  8,   // B
  9,   // C
  10,  // D
  11,  // E
  12,  // LAT
  13,  // OE
  14   // CLK
};

constexpr uint16_t kHub75PanelWidth = 64;
constexpr uint16_t kHub75PanelHeight = 64;
constexpr uint16_t kHub75ChainLength = 1;
// Keep the driver configurable in one place. We are trying FM6126A first
// because this panel still ignores brightness changes with SHIFTREG-style init.
constexpr HUB75_I2S_CFG::shift_driver kHub75Driver = HUB75_I2S_CFG::FM6126A;

}  // namespace beadcraft
