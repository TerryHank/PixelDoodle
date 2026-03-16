# -*- coding: utf-8 -*-
import re

with open(r'd:\Workspace\PixelDoodle\static\app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 使用正则表达式修复所有 't('xxx')' 格式的错误
# 匹配 't('...')' 并替换为 t('...')
content = re.sub(r"'t\('([^']+)'[^']*'", r"t('\1')", content)

with open(r'd:\Workspace\PixelDoodle\static\app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed all malformed t() calls')
