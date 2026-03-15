#include <Arduino.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include "BeadCraftReceiver.h"

#define ESP32_LED_BUILTIN 2

MatrixPanel_I2S_DMA *dma_display = nullptr;
BeadCraftReceiver *receiver = nullptr;

void setup()
{
  Serial.begin(460800);
  pinMode(ESP32_LED_BUILTIN, OUTPUT);
  
  // Blink LED 3 times
  for (int i = 0; i < 3; i++) {
    digitalWrite(ESP32_LED_BUILTIN, HIGH);
    delay(100);
    digitalWrite(ESP32_LED_BUILTIN, LOW);
    delay(100);
  }
  
  // Initialize display
  HUB75_I2S_CFG mxconfig(64, 64, 1);
  mxconfig.gpio.e = 18;
  mxconfig.clkphase = false;
  mxconfig.double_buff = false;
  
  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  dma_display->setBrightness8(64);
  
  receiver = new BeadCraftReceiver(dma_display);
  
  // Show welcome screen "像素豆绘"
  receiver->displayWelcome();
  delay(2000);  // Show for 2 seconds
  
  // Then show upload icon (waiting for image)
  receiver->displayUploadIcon();
  
  Serial.println("READY460K");
}

void loop()
{
  receiver->update();
}
