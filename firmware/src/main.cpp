#include <Arduino.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include "BeadCraftReceiver.h"
#include "BLEImageReceiver.h"

#define ESP32_LED_BUILTIN 2

#ifndef PAIRING_BASE_URL
#define PAIRING_BASE_URL "https://example.com/"
#endif

MatrixPanel_I2S_DMA *dma_display = nullptr;
BeadCraftReceiver *receiver = nullptr;
BLEImageReceiver *bleReceiver = nullptr;

String getDeviceCode()
{
  const uint64_t chipId = ESP.getEfuseMac();
  char code[13];
  snprintf(code, sizeof(code), "%012llX", chipId & 0xFFFFFFFFFFFFULL);
  return String(code);
}

String buildPairingUrl(const String &deviceCode)
{
  String baseUrl = String(PAIRING_BASE_URL);
  baseUrl.replace("https://", "");
  baseUrl.replace("http://", "");
  if (baseUrl.endsWith("/")) {
    baseUrl.remove(baseUrl.length() - 1);
  }
  if (baseUrl.indexOf('?') >= 0) {
    return baseUrl + "&u=" + deviceCode;
  }
  return baseUrl + "?u=" + deviceCode;
}

void setup()
{
  Serial.begin(460800);
  pinMode(ESP32_LED_BUILTIN, OUTPUT);

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
  const String pairingUrl = buildPairingUrl(deviceCode);

  receiver->displayWelcome();
  delay(2000);

  receiver->displayPairingScreen(deviceCode, pairingUrl);
  bleReceiver->begin(deviceCode);

  Serial.printf("READY_BLE:%s\n", deviceCode.c_str());
  Serial.printf("PAIR_URL:%s\n", pairingUrl.c_str());
}

void loop()
{
  bleReceiver->update();
}
