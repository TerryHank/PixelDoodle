import { Image, Text, View } from '@tarojs/components'
import './index.scss'

export interface ExampleGalleryItem {
  id: string
  title: string
  subtitle: string
  tone: 'ink' | 'rose' | 'sky' | 'mint'
  thumbnailUrl?: string
  sourceUrl: string
}

export interface ExampleGalleryProps {
  items: ExampleGalleryItem[]
  onSelectExample?: (item: ExampleGalleryItem) => void
}

export function ExampleGallery({ items, onSelectExample }: ExampleGalleryProps) {
  return (
    <View className='section examples-section'>
      <Text className='section-title'>示例图片</Text>
      <View className='examples-gallery'>
        {items.map((item) => (
          <View
            key={item.id}
            className='example-item'
            onClick={() => onSelectExample?.(item)}
          >
            <View className='example-thumb-frame'>
              <Image
                className='example-thumb'
                mode='aspectFill'
                src={item.thumbnailUrl || ''}
              />
            </View>
            <Text className='example-name'>{item.title}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
