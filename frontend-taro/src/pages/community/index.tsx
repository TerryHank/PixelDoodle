import Taro from '@tarojs/taro'
import { Input, ScrollView, Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import { AppTabBar } from '@/components/app-tab-bar'
import { PatternThumb } from '@/components/pattern-thumb'
import { ProfileAvatar } from '@/components/profile-avatar'
import { fileAdapter } from '@/adapters/file'
import {
  addCommunityComment,
  getCommunityDownloadUrl,
  getCommunityPostDetail,
  listCommunityPosts
} from '@/services/community-service'
import { useUserStore } from '@/store/user-store'
import { getExportFileName, getExportMimeType } from '@/utils/export'
import type { CommunityPost, CommunityPostDetail } from '@/types/community'
import './index.scss'

export default function CommunityPage() {
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [selectedPost, setSelectedPost] = useState<CommunityPostDetail | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmittingComment, setIsSubmittingComment] = useState(false)
  const userId = useUserStore((state) => state.id)
  const userNickname = useUserStore((state) => state.nickname)
  const userAvatarSeed = useUserStore((state) => state.avatarSeed)

  async function refreshPosts() {
    setIsLoading(true)
    try {
      const response = await listCommunityPosts(24)
      setPosts(response.posts)
    } catch (error) {
      Taro.showToast({
        title: error instanceof Error ? error.message : '社区加载失败',
        icon: 'none'
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshPosts()
  }, [])

  async function openPost(postId: number) {
    try {
      const detail = await getCommunityPostDetail(postId)
      setSelectedPost(detail)
    } catch (error) {
      Taro.showToast({
        title: error instanceof Error ? error.message : '作品详情加载失败',
        icon: 'none'
      })
    }
  }

  async function handleDownload(postId: number, kind: 'json' | 'png') {
    Taro.showLoading({
      title: '下载中...'
    })

    try {
      const url = getCommunityDownloadUrl(postId, kind)
      if (typeof fetch === 'function') {
        const response = await fetch(url)
        const buffer = await response.arrayBuffer()
        await fileAdapter.saveBinaryFile(
          getExportFileName(kind, String(postId)),
          getExportMimeType(kind),
          buffer
        )
      } else {
        const response = await Taro.request<ArrayBuffer>({
          url,
          responseType: 'arraybuffer'
        })
        await fileAdapter.saveBinaryFile(
          getExportFileName(kind, String(postId)),
          getExportMimeType(kind),
          response.data
        )
      }

      Taro.showToast({
        title: `已下载 ${kind.toUpperCase()}`,
        icon: 'none'
      })
      if (selectedPost?.id === postId) {
        const detail = await getCommunityPostDetail(postId)
        setSelectedPost(detail)
      } else {
        await refreshPosts()
      }
    } catch (error) {
      Taro.showToast({
        title: error instanceof Error ? error.message : '下载失败',
        icon: 'none'
      })
    } finally {
      Taro.hideLoading()
    }
  }

  async function handleSubmitComment() {
    if (!selectedPost || !commentDraft.trim()) {
      return
    }

    setIsSubmittingComment(true)
    try {
      const detail = await addCommunityComment(selectedPost.id, {
        author_id: userId,
        author_nickname: userNickname,
        author_avatar_seed: userAvatarSeed,
        content: commentDraft.trim()
      })
      setSelectedPost(detail)
      setCommentDraft('')
      await refreshPosts()
    } catch (error) {
      Taro.showToast({
        title: error instanceof Error ? error.message : '评论失败',
        icon: 'none'
      })
    } finally {
      setIsSubmittingComment(false)
    }
  }

  return (
    <View className='community-page'>
      <ScrollView className='community-page__scroll' scrollY>
        <View className='community-page__content'>
          <View className='community-page__hero'>
            <Text className='community-page__title'>社区</Text>
            <Text className='community-page__subtitle'>
              像 MakerWorld 一样浏览、评论、下载其他用户的拼豆作品。
            </Text>
          </View>

          {isLoading ? (
            <View className='community-page__empty'>
              <Text>正在加载社区作品...</Text>
            </View>
          ) : posts.length === 0 ? (
            <View className='community-page__empty'>
              <Text>社区还没有作品，去工具页发布第一张吧。</Text>
            </View>
          ) : (
            <View className='community-feed'>
              {posts.map((post) => (
                <View className='community-card' key={post.id}>
                  <View className='community-card__header'>
                    <ProfileAvatar
                      nickname={post.author.nickname}
                      seed={post.author.avatar_seed}
                      size='sm'
                    />
                    <View className='community-card__author'>
                      <Text className='community-card__title'>{post.title}</Text>
                      <Text className='community-card__meta'>
                        {post.author.nickname} · {post.grid_size.width}x{post.grid_size.height} ·{' '}
                        {post.total_beads} 颗
                      </Text>
                    </View>
                    <PatternThumb
                      colorSummary={post.color_summary}
                      pixelMatrix={post.pixel_matrix}
                    />
                  </View>
                  <Text className='community-card__description'>{post.description || '这位作者还没有写作品描述。'}</Text>
                  <View className='community-card__stats'>
                    <Text>评论 {post.comments_count}</Text>
                    <Text>下载 {post.downloads}</Text>
                  </View>
                  <View className='community-card__actions'>
                    <View className='community-card__button' onClick={() => void openPost(post.id)}>
                      <Text>评论</Text>
                    </View>
                    <View className='community-card__button' onClick={() => void handleDownload(post.id, 'json')}>
                      <Text>下载 JSON</Text>
                    </View>
                    <View className='community-card__button community-card__button--primary' onClick={() => void handleDownload(post.id, 'png')}>
                      <Text>下载 PNG</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {selectedPost ? (
        <View className='community-detail-sheet'>
          <View className='community-detail-sheet__mask' onClick={() => setSelectedPost(null)} />
          <View className='community-detail-sheet__panel'>
            <View className='community-detail-sheet__header'>
              <View>
                <Text className='community-detail-sheet__title'>{selectedPost.title}</Text>
                <Text className='community-detail-sheet__subtitle'>
                  {selectedPost.author.nickname} · 下载 {selectedPost.downloads}
                </Text>
              </View>
              <View className='community-detail-sheet__close' onClick={() => setSelectedPost(null)}>
                <Text>×</Text>
              </View>
            </View>
            <View className='community-detail-sheet__preview'>
              <PatternThumb
                colorSummary={selectedPost.color_summary}
                pixelMatrix={selectedPost.pixel_matrix}
              />
              <Text className='community-detail-sheet__description'>
                {selectedPost.description || '这位作者还没有写作品描述。'}
              </Text>
            </View>
            <View className='community-detail-sheet__comment-list'>
              {selectedPost.comments.length === 0 ? (
                <Text className='community-detail-sheet__empty'>还没有评论，来写第一条。</Text>
              ) : (
                selectedPost.comments.map((comment) => (
                  <View className='community-comment' key={comment.id}>
                    <ProfileAvatar
                      nickname={comment.author.nickname}
                      seed={comment.author.avatar_seed}
                      size='sm'
                    />
                    <View className='community-comment__body'>
                      <Text className='community-comment__author'>{comment.author.nickname}</Text>
                      <Text className='community-comment__content'>{comment.content}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
            <Input
              className='community-detail-sheet__input'
              value={commentDraft}
              placeholder='写下你的评论'
              onInput={(event) => setCommentDraft(event.detail.value)}
            />
            <View
              className={`community-detail-sheet__submit ${
                isSubmittingComment ? 'community-detail-sheet__submit--disabled' : ''
              }`}
              onClick={() => {
                if (isSubmittingComment) {
                  return
                }
                void handleSubmitComment()
              }}
            >
              <Text>{isSubmittingComment ? '提交中...' : '发送评论'}</Text>
            </View>
          </View>
        </View>
      ) : null}

      <AppTabBar current='community' />
    </View>
  )
}
