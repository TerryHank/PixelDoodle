# PixelDoodle 内置离线素材库

`offline-materials-v1.json` 是 H5/Tauri Android 无后端运行时的素材兜底包。

- 母库：`../../../perler-beads/data/gallery`，共 64,268 条已校验作品。
- 内置：按 6 种钉板尺寸、12 个分类和 5 个来源确定性选取 1,200 条。
- 生成：`npm run build:offline-gallery`。
- 数据保留来源、分类和标签；授权依据见仓库根目录
  `data/external-materials/SOURCES.md`。

在线素材 API 配置存在时仍可使用在线库；未配置时读取本文件夹中的离线包。
