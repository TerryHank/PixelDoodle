import { Text, View } from '@tarojs/components'
import './index.scss'

export interface ExampleGalleryItem {
  id: string
  title: string
  subtitle: string
  tone: 'ink' | 'rose' | 'sky' | 'mint'
}

export interface ExampleGalleryProps {
  items: ExampleGalleryItem[]
}

export function ExampleGallery({ items }: ExampleGalleryProps) {
  return (
    <View className='example-gallery section-block'>
      <Text className='section-block__title'>示例图片</Text>
      <View className='example-gallery__grid'>
        {items.map((item) => (
          <View key={item.id} className='example-gallery__item'>
            <View className={`example-gallery__thumb example-gallery__thumb--${item.tone}`}>
              <Text className='example-gallery__thumb-label'>{item.title.slice(0, 2)}</Text>
            </View>
            <Text className='example-gallery__name'>{item.title}</Text>
            <Text className='example-gallery__subtitle'>{item.subtitle}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
