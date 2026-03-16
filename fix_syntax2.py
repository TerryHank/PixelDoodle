# -*- coding: utf-8 -*-
import re

with open(r'd:\Workspace\PixelDoodle\static\app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 修复所有错误的引号格式
fixes = [
    ("'t('qr.scan_hint')'", "t('qr.scan_hint')"),
    ("'t('wifi.scan_hint')'", "t('wifi.scan_hint')"),
    ("'t('wifi.scan_results_placeholder')'", "t('wifi.scan_results_placeholder')"),
    ("'t('qr.recognizing')'", "t('qr.recognizing')"),
    ("'t('ble.connecting_scan')'", "t('ble.connecting_scan')"),
    ("'t('wifi.select_first')'", "t('wifi.select_first')"),
    ("'t('wifi.enter_password')'", "t('wifi.enter_password')"),
]

for old, new in fixes:
    content = content.replace(old, new)

with open(r'd:\Workspace\PixelDoodle\static\app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed all syntax errors')
