import { SanityDocument } from '@sanity/client'
import { Piece } from './piece'

export type EditionStatus = 'unreviewed' | 'approved' | 'rejected'

export interface Edition extends SanityDocument {
  _type: 'edition'
  slug: {
    current: string
    _type: 'slug'
  }
  publisher: string
  copyright: string
  editor: string
  url: string
  piece: {
    _type: 'reference'
    _ref: string
  }
  status: EditionStatus
  rejectionReason?: string
  reviewedAt?: string
} 