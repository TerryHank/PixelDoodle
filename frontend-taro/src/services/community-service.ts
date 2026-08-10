import { requestJson } from './http'
import type {
  CommunityPost,
  CommunityPostDetail,
  PublishCommunityPostRequest
} from '@/types/community'
import { getApiBaseUrl } from './env'

export async function listCommunityPosts(limit = 20) {
  return requestJson<{ posts: CommunityPost[] }>(`/api/community/posts?limit=${limit}`)
}

export async function getCommunityPostDetail(postId: number) {
  return requestJson<CommunityPostDetail>(`/api/community/posts/${postId}`)
}

export async function publishCommunityPost(payload: PublishCommunityPostRequest) {
  return requestJson<CommunityPost>('/api/community/posts', {
    method: 'POST',
    header: {
      'content-type': 'application/json'
    },
    data: payload
  })
}

export async function addCommunityComment(postId: number, payload: {
  author_id: string
  author_nickname: string
  author_avatar_seed: string
  content: string
}) {
  return requestJson<CommunityPostDetail>(`/api/community/posts/${postId}/comments`, {
    method: 'POST',
    header: {
      'content-type': 'application/json'
    },
    data: payload
  })
}

export function getCommunityDownloadUrl(postId: number, kind: 'json' | 'png') {
  return `${getApiBaseUrl()}/api/community/posts/${postId}/download/${kind}`
}
