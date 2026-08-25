import { useMemo, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Input, Picker, ScrollView, Text, View } from '@tarojs/components'
import { AppTabBar } from '@/components/app-tab-bar'
import { PatternThumb } from '@/components/pattern-thumb'
import { buildPatternStateFromHistory } from '@/features/pixel-editor/history'
import { filterLocalGallery, type GallerySort } from '@/features/local-gallery/model'
import { BOARD_SIZE_OPTIONS } from '@/features/pixel-editor/model'
import { useHistoryStore } from '@/store/history-store'
import { usePatternStore } from '@/store/pattern-store'
import './index.scss'

const SIZE_OPTIONS = [
  { id: 'all', label: '全部尺寸' },
  ...BOARD_SIZE_OPTIONS.map((item) => ({ id: `${item.width}x${item.height}`, label: item.label }))
]
const SORT_OPTIONS: Array<{ id: GallerySort; label: string }> = [
  { id: 'newest', label: '最近保存' },
  { id: 'oldest', label: '最早保存' },
  { id: 'name', label: '名称排序' }
]

export default function LocalGalleryPage() {
  const entries = useHistoryStore((state) => state.entries)
  const renameEntry = useHistoryStore((state) => state.renameEntry)
  const removeEntry = useHistoryStore((state) => state.removeEntry)
  const [query, setQuery] = useState('')
  const [size, setSize] = useState('all')
  const [sort, setSort] = useState<GallerySort>('newest')
  const [editingId, setEditingId] = useState('')
  const [editingTitle, setEditingTitle] = useState('')

  const visibleEntries = useMemo(
    () => filterLocalGallery(entries, query, size, sort),
    [entries, query, size, sort]
  )

  async function continueEditing(id: string) {
    const entry = entries.find((item) => item.id === id)
    if (!entry) return
    usePatternStore.setState(buildPatternStateFromHistory(entry))
    await Taro.redirectTo({ url: '/pages/home/index' })
  }

  async function confirmDelete(id: string, title: string) {
    const result = await Taro.showModal({
      title: '删除本地作品',
      content: `确定删除「${title}」吗？删除后无法恢复。`,
      confirmText: '删除',
      confirmColor: '#c2410c'
    })
    if (result.confirm) removeEntry(id)
  }

  return (
    <View className='local-gallery-page'>
      <ScrollView className='local-gallery-page__scroll' scrollY>
        <View className='local-gallery-page__content'>
          <View className='local-gallery-page__heading'>
            <Text className='local-gallery-page__eyebrow'>离线双保存</Text>
            <Text className='local-gallery-page__title'>本地图库</Text>
            <Text className='local-gallery-page__subtitle'>搜索、筛选并继续编辑已经保存的拼豆作品。</Text>
          </View>

          <View className='local-gallery-page__filters'>
            <Input
              aria-label='搜索本地作品'
              placeholder='搜索作品名或来源'
              value={query}
              onInput={(event) => setQuery(event.detail.value)}
            />
            <Picker
              mode='selector'
              range={SIZE_OPTIONS.map((item) => item.label)}
              value={Math.max(0, SIZE_OPTIONS.findIndex((item) => item.id === size))}
              onChange={(event) => setSize(SIZE_OPTIONS[Number(event.detail.value)]?.id ?? 'all')}
            >
              <View className='local-gallery-page__picker' aria-label='筛选作品尺寸'>
                {SIZE_OPTIONS.find((item) => item.id === size)?.label}
              </View>
            </Picker>
            <Picker
              mode='selector'
              range={SORT_OPTIONS.map((item) => item.label)}
              value={Math.max(0, SORT_OPTIONS.findIndex((item) => item.id === sort))}
              onChange={(event) => setSort(SORT_OPTIONS[Number(event.detail.value)]?.id ?? 'newest')}
            >
              <View className='local-gallery-page__picker' aria-label='本地作品排序'>
                {SORT_OPTIONS.find((item) => item.id === sort)?.label}
              </View>
            </Picker>
          </View>

          <Text className='local-gallery-page__count'>共 {visibleEntries.length} 个作品</Text>
          {visibleEntries.length === 0 ? (
            <View className='local-gallery-page__empty'>
              <Text>{entries.length ? '没有符合条件的作品' : '还没有本地作品，请先在创作页保存'}</Text>
            </View>
          ) : (
            <View className='local-gallery-page__list'>
              {visibleEntries.map((entry) => (
                <View className='local-work-card' key={entry.id}>
                  <PatternThumb colorSummary={entry.colorSummary} pixelMatrix={entry.pixelMatrix} />
                  <View className='local-work-card__meta'>
                    {editingId === entry.id ? (
                      <Input
                        aria-label='新的作品名称'
                        maxlength={40}
                        value={editingTitle}
                        onInput={(event) => setEditingTitle(event.detail.value)}
                      />
                    ) : (
                      <Text className='local-work-card__title'>{entry.title}</Text>
                    )}
                    <Text>{entry.sourceLabel}</Text>
                    <Text>{entry.gridSize.width}×{entry.gridSize.height} · {entry.totalBeads} 颗</Text>
                    <Text>{new Date(entry.createdAt).toLocaleString()}</Text>
                  </View>
                  <View className='local-work-card__actions'>
                    {editingId === entry.id ? (
                      <>
                        <Button
                          size='mini'
                          disabled={!editingTitle.trim()}
                          onClick={() => {
                            if (renameEntry(entry.id, editingTitle)) setEditingId('')
                          }}
                        >保存名称</Button>
                        <Button size='mini' onClick={() => setEditingId('')}>取消</Button>
                      </>
                    ) : (
                      <>
                        <Button size='mini' onClick={() => void continueEditing(entry.id)}>继续编辑</Button>
                        <Button
                          size='mini'
                          onClick={() => {
                            setEditingId(entry.id)
                            setEditingTitle(entry.title)
                          }}
                        >重命名</Button>
                        <Button size='mini' onClick={() => void confirmDelete(entry.id, entry.title)}>删除</Button>
                      </>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      <AppTabBar current='localGallery' />
    </View>
  )
}
