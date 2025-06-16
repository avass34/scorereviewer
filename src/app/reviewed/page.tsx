'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@sanity/client'
import { Piece } from '@/types/piece'
import { Edition } from '@/types/edition'
import Link from 'next/link'

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  useCdn: false,
  apiVersion: '2024-02-20',
})

type FilterStatus = 'all' | 'approved' | 'rejected'

interface PieceWithEditions extends Piece {
  editions: Edition[]
}

export default function ReviewedPiecesPage() {
  const [pieces, setPieces] = useState<PieceWithEditions[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [changingStatus, setChangingStatus] = useState<string | null>(null)
  const [changingPieceStatus, setChangingPieceStatus] = useState<string | null>(null)

  const fetchPieces = async () => {
    try {
      setLoading(true)
      let query = `*[_type == "piece" && status == "reviewed" ${
        filterStatus !== 'all' ? `&& editions[].status == "${filterStatus}"` : ''
      }] {
        _id,
        _type,
        piece_title,
        composer,
        year_of_composition,
        era,
        status,
        slug,
        "editions": *[_type == "edition" && references(^._id)] {
          _id,
          _type,
          slug,
          publisher,
          copyright,
          editor,
          url,
          status,
          rejectionReason,
          reviewedAt
        }
      } | order(_createdAt desc)`

      const result = await client.fetch<PieceWithEditions[]>(query)
      setPieces(result)
    } catch (err) {
      console.error('Error fetching pieces:', err)
      setError('Failed to fetch pieces')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPieces()
  }, [filterStatus])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }

  const handleEditionStatusChange = async (edition: Edition, newStatus: Edition['status']) => {
    if (changingStatus === edition._id) return // Prevent multiple simultaneous changes
    
    try {
      setChangingStatus(edition._id)

      const response = await fetch('/api/editions', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          editionId: edition._id,
          status: newStatus,
          reviewedAt: new Date().toISOString(),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update edition status')
      }

      // Update the edition in the local state
      setPieces(prevPieces => 
        prevPieces.map(piece => ({
          ...piece,
          editions: piece.editions.map(e => 
            e._id === edition._id 
              ? { ...e, status: newStatus, reviewedAt: new Date().toISOString() }
              : e
          )
        }))
      )
    } catch (err) {
      console.error('Error updating status:', err)
      setError('Failed to update edition status')
    } finally {
      setChangingStatus(null)
    }
  }

  const handlePieceStatusChange = async (piece: Piece, newStatus: Piece['status']) => {
    if (changingPieceStatus === piece._id) return // Prevent multiple simultaneous changes
    
    try {
      setChangingPieceStatus(piece._id)

      const response = await fetch('/api/pieces', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pieceId: piece._id,
          status: newStatus,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update piece status')
      }

      // Update the piece in the local state
      setPieces(prevPieces => 
        prevPieces.map(p => 
          p._id === piece._id 
            ? { ...p, status: newStatus }
            : p
        )
      )
    } catch (err) {
      console.error('Error updating piece status:', err)
      setError('Failed to update piece status')
    } finally {
      setChangingPieceStatus(null)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  if (error) {
    return <div className="text-red-500">{error}</div>
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Reviewed Pieces</h1>
        <Link 
          href="/review" 
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Review New Pieces
        </Link>
      </div>

      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search pieces..."
            className="w-full px-4 py-2 border rounded"
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
          className="px-4 py-2 border rounded bg-white"
        >
          <option value="all">All Editions</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="space-y-6">
        {pieces.map((piece) => (
          <div key={piece._id} className="bg-black rounded-lg shadow p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">{piece.piece_title}</h2>
                <p className="text-gray-400">by {piece.composer}</p>
                <p className="text-gray-400">
                  {piece.year_of_composition} • {piece.era}
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <select
                  value={piece.status || 'unreviewed'}
                  onChange={(e) => handlePieceStatusChange(piece, e.target.value as Piece['status'])}
                  disabled={changingPieceStatus === piece._id}
                  className="bg-gray-800 text-gray-300 text-sm rounded border border-gray-700 px-2 py-1"
                >
                  <option value="unreviewed">Unreviewed</option>
                  <option value="reviewed">Reviewed</option>
                </select>
                {changingPieceStatus === piece._id && (
                  <span className="text-gray-400 text-sm">Updating...</span>
                )}
              </div>
            </div>

            <div className="mt-4">
              <h3 className="text-lg font-semibold mb-2">Editions</h3>
              <div className="space-y-2">
                {piece.editions.map((edition) => (
                  <div key={edition._id} className="flex items-center justify-between p-3 bg-gray-900 rounded">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{edition.publisher}</span>
                        {edition.editor && (
                          <span className="text-gray-400">• Editor: {edition.editor}</span>
                        )}
                      </div>
                      {edition.copyright && (
                        <p className="text-sm text-gray-400 mt-1">© {edition.copyright}</p>
                      )}
                    </div>
                    <div className="flex items-center space-x-4">
                      {edition.url && (
                        <button
                          onClick={() => window.open(edition.url, 'scoreWindow', 'width=800,height=600')}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          View Edition
                        </button>
                      )}
                      <div className="flex items-center space-x-2">
                        <select
                          value={edition.status || 'unreviewed'}
                          onChange={(e) => handleEditionStatusChange(edition, e.target.value as Edition['status'])}
                          disabled={changingStatus === edition._id}
                          className="bg-gray-800 text-gray-300 text-sm rounded border border-gray-700 px-2 py-1"
                        >
                          <option value="unreviewed">Unreviewed</option>
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                        </select>
                        {changingStatus === edition._id && (
                          <span className="text-gray-400 text-sm">Updating...</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
} 