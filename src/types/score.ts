import { SanityDocument } from '@sanity/client'

export type ScoreStatus = 'unreviewed' | 'approved' | 'rejected'

export interface Score extends SanityDocument {
  _type: 'score'
  pieceName: string
  composerName: string
  slug: {
    current: string
    _type: 'slug'
  }
  scoreUrl: string
  editor: string
  publisher: string
  language: string
  copyright: string
  status: ScoreStatus
  rejectionReason?: string
  reviewedAt?: string
  summary?: string
} 