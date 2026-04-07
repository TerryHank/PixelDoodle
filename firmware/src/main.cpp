#include <Arduino.h>
#include <esp_system.h>
#include <esp_log.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <WiFi.h>
#include "BeadCraftReceiver.h"
#include "BLEImageReceiver.h"

#define ESP32_LED_BUILTIN 2

MatrixPanel_I2S_DMA *dma_display = nullptr;
BeadCraftReceiver *receiver = nullptr;
BLEImageReceiver *bleReceiver = nullptr;
RTC_DATA_ATTR uint32_t g_bootCount = 0;

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

  esp_log_level_set("wifi", ESP_LOG_NONE);
  esp_log_level_set("wifi_init", ESP_LOG_NONE);
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, true);
  delay(100);

  for (int i = 0; i < 3; i++) {
    digitalWrite(ESP32_LED_BUILTIN, HIGH);
    delay(100);
    digitalWrite(ESP32_LED_BUILTIN, LOW);
    delay(100);
  }

  HUB75_I2S_CFG mxconfig(64, 64, 1);
  mxconfig.gpio.e = 18;
  mxconfig.clkphase = false;
  mxconfig.double_buff = false;

  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  dma_display->setBrightness8(64);

  receiver = new BeadCraftReceiver(dma_display);
  bleReceiver = new BLEImageReceiver(dma_display);

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
