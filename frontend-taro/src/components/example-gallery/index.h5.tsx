import './index.h5.scss'

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
    <div className='section examples-section' style={{ marginTop: 12 }}>
      <div className='section-title'>示例图片</div>
      <div className='examples-gallery'>
        {items.map((item) => (
          <div
            className='example-item'
            key={item.id}
            onClick={() => onSelectExample?.(item)}
          >
            <img alt={item.title} className='example-thumb' src={item.thumbnailUrl} />
            <div className='example-name'>{item.title}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
