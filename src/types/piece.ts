import { SanityDocument } from '@sanity/client'

export type PieceStatus = 'unreviewed' | 'reviewed'

export interface Piece extends SanityDocument {
  _type: 'piece'
  piece_title: string
  composer: string
  year_of_composition: number
  era: string
  status: PieceStatus
  slug: {
    current: string
    _type: 'slug'
  }
} 