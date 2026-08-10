import type { ColorSummaryItem, GridSize, PixelMatrix } from './api'

export interface UserProfile {
  id: string
  nickname: string
  avatarSeed: string
  bio: string
  autoShareToCommunity: boolean
}

export interface PatternHistoryEntry {
  id: string
  title: string
  createdAt: string
  sourceLabel: string
  gridSize: GridSize
  totalBeads: number
  palettePreset: string
  pixelMatrix: PixelMatrix
  colorSummary: ColorSummaryItem[]
}

export interface CommunityAuthor {
  id: string
  nickname: string
  avatar_seed: string
}

export interface CommunityComment {
  id: number
  post_id: number
  author: CommunityAuthor
  content: string
  created_at: string
}

export interface CommunityPost {
  id: number
  title: string
  description: string
  author: CommunityAuthor
  palette_preset: string
  grid_size: GridSize
  total_beads: number
  pixel_matrix: PixelMatrix
  color_summary: ColorSummaryItem[]
  created_at: string
  downloads: number
  comments_count: number
}

export interface CommunityPostDetail extends CommunityPost {
  comments: CommunityComment[]
}

export interface PublishCommunityPostRequest {
  title: string
  description: string
  author_id: string
  author_nickname: string
  author_avatar_seed: string
  palette_preset: string
  grid_size: GridSize
  total_beads: number
  pixel_matrix: PixelMatrix
  color_summary: ColorSummaryItem[]
}
