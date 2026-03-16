# -*- coding: utf-8 -*-
import re

with open(r'd:\Workspace\PixelDoodle\static\app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 修复语法错误：函数参数中的错误格式
fixes = [
    # 修复函数默认参数
    ("emptyMessage = 't('wifi.scan_results_placeholder')'", "emptyMessage = t('wifi.scan_results_placeholder')"),
    # 修复其他可能的类似问题
    ("'t('wifi.scan_results_placeholder')'", "t('wifi.scan_results_placeholder')"),
]

for old, new in fixes:
    content = content.replace(old, new)

with open(r'd:\Workspace\PixelDoodle\static\app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed syntax errors')
