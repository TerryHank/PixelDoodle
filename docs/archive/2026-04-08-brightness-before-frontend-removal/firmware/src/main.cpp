#include <Arduino.h>
#include <Preferences.h>
#include <esp_system.h>
#include <esp_log.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include "Hub75ReferenceConfig.h"
#include "BeadCraftReceiver.h"
#include "BLEImageReceiver.h"

#define ESP32_LED_BUILTIN 2

using beadcraft::kHub75ChainLength;
using beadcraft::kHub75Driver;
using beadcraft::kHub75PanelHeight;
using beadcraft::kHub75PanelWidth;
using beadcraft::kHub75Pins;

MatrixPanel_I2S_DMA *dma_display = nullptr;
BeadCraftReceiver *receiver = nullptr;
BLEImageReceiver *bleReceiver = nullptr;
RTC_DATA_ATTR uint32_t g_bootCount = 0;
Preferences g_preferences;
uint8_t g_brightness = 64;

constexpr uint8_t kMinBrightness = 26;
constexpr uint8_t kMaxBrightness = 255;
constexpr uint8_t kDefaultBrightness = 64;

String getDeviceCode();

uint8_t clampBrightness(uint8_t value)
{
  if (value < kMinBrightness) return kMinBrightness;
  if (value > kMaxBrightness) return kMaxBrightness;
  return value;
}

uint8_t loadBrightness()
{
  g_brightness = clampBrightness(g_preferences.getUChar("brightness", kDefaultBrightness));
  return g_brightness;
}

void applyBrightness(uint8_t value, bool persist)
{
  g_brightness = clampBrightness(value);
  if (dma_display) {
    dma_display->setBrightness8(g_brightness);
    // Match the reference project's brightness path: clear the DMA buffer first,
    // then redraw the active screen so the new OE timing is applied everywhere.
    dma_display->clearScreen();
    if (bleReceiver && bleReceiver->hasImage()) {
      bleReceiver->displayStoredImage();
    } else if (receiver) {
      receiver->displayDeviceCodeScreen(getDeviceCode());
    }
  }
  if (persist) {
    g_preferences.putUChar("brightness", g_brightness);
  }
}

uint8_t getBrightness()
{
  return g_brightness;
}

const char* resetReasonToString(esp_reset_reason_t reason)
{
  switch (reason) {
    case ESP_RST_UNKNOWN: return "unknown";
    case ESP_RST_POWERON: return "poweron";
    case ESP_RST_EXT: return "external";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "int_wdt";
    case ESP_RST_TASK_WDT: return "task_wdt";
    case ESP_RST_WDT: return "wdt";
    case ESP_RST_DEEPSLEEP: return "deepsleep";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    default: return "other";
  }
}

String getDeviceCode()
{
  const uint64_t chipId = ESP.getEfuseMac();
  char code[13];
  snprintf(code, sizeof(code), "%012llX", chipId & 0xFFFFFFFFFFFFULL);
  return String(code);
}

void setup()
{
  Serial.begin(115200);
  delay(200);
  pinMode(ESP32_LED_BUILTIN, OUTPUT);
  g_bootCount++;

  const esp_reset_reason_t resetReason = esp_reset_reason();
  Serial.printf("BOOT:%lu RESET:%s(%d)\n", static_cast<unsigned long>(g_bootCount), resetReasonToString(resetReason), static_cast<int>(resetReason));

  for (int i = 0; i < 3; i++) {
    digitalWrite(ESP32_LED_BUILTIN, HIGH);
    delay(100);
    digitalWrite(ESP32_LED_BUILTIN, LOW);
    delay(100);
  }

  HUB75_I2S_CFG mxconfig(kHub75PanelWidth, kHub75PanelHeight, kHub75ChainLength, kHub75Pins);
  mxconfig.clkphase = false;
  mxconfig.double_buff = false;
  mxconfig.driver = kHub75Driver;

  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  g_preferences.begin("beadcraft", false);
  dma_display->setBrightness8(loadBrightness());
  dma_display->clearScreen();

  receiver = new BeadCraftReceiver(dma_display);
  bleReceiver = new BLEImageReceiver(dma_display, applyBrightness, getBrightness);

  const String deviceCode = getDeviceCode();

  receiver->displayWelcome();
  delay(2000);

  receiver->displayDeviceCodeScreen(deviceCode);
  bleReceiver->begin(deviceCode);

  Serial.printf("READY_BLE:%s\n", deviceCode.c_str());
}

void loop()
{
  bleReceiver->update();
}
