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

const PIECES_PER_PAGE = 5

type FilterStatus = 'all' | 'unreviewed' | 'reviewed'

interface PieceWithEditions extends Piece {
  editions: Edition[]
}

export default function ReviewPage() {
  const [pieces, setPieces] = useState<PieceWithEditions[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [changingStatus, setChangingStatus] = useState<string | null>(null)
  const [selectedEdition, setSelectedEdition] = useState<Edition | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPieces, setTotalPieces] = useState(0)
  const [searchResults, setSearchResults] = useState<PieceWithEditions[]>([])
  const [isSearching, setIsSearching] = useState(false)

  const fetchPieces = async (page: number) => {
    try {
      setLoading(true)
      console.log('Fetching pieces page:', page)

      // First get total count
      const countQuery = `count(*[_type == "piece" ${
        filterStatus !== 'all' ? `&& status == "${filterStatus}"` : ''
      }])`
      const total = await client.fetch<number>(countQuery)
      setTotalPieces(total)

      // Then fetch the current page
      let query = `*[_type == "piece" ${
        filterStatus !== 'all' ? `&& status == "${filterStatus}"` : ''
      } && status != "reviewed"] | order(_createdAt desc) [$start...$end] {
        _id,
        _type,
        piece_title,
        composer,
        year_of_composition,
        era,
        "status": coalesce(status, "unreviewed"),
        slug,
        "editions": *[_type == "edition" && references(^._id)] {
          _id,
          _type,
          slug,
          publisher,
          copyright,
          editor,
          url,
          "status": coalesce(status, "unreviewed"),
          rejectionReason,
          reviewedAt
        }
      }`

      const result = await client.fetch<PieceWithEditions[]>(query, {
        start: page * PIECES_PER_PAGE,
        end: (page + 1) * PIECES_PER_PAGE
      })
      console.log('Fetched pieces:', result)
      setPieces(result)
    } catch (err) {
      console.error('Error fetching pieces:', err)
      setError('Failed to fetch pieces')
    } finally {
      setLoading(false)
    }
  }

  const searchPieces = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    try {
      setIsSearching(true)
      const searchQuery = `*[_type == "piece" && (
        piece_title match "*${query}*" ||
        composer match "*${query}*"
      ) && status != "reviewed"] {
        _id,
        _type,
        piece_title,
        composer,
        year_of_composition,
        era,
        "status": coalesce(status, "unreviewed"),
        slug,
        "editions": *[_type == "edition" && references(^._id)] {
          _id,
          _type,
          slug,
          publisher,
          copyright,
          editor,
          url,
          "status": coalesce(status, "unreviewed"),
          rejectionReason,
          reviewedAt
        }
      } | order(_createdAt desc)[0...10]`

      const results = await client.fetch<PieceWithEditions[]>(searchQuery)
      setSearchResults(results)
    } catch (err) {
      console.error('Error searching pieces:', err)
      setError('Failed to search pieces')
    } finally {
      setIsSearching(false)
    }
  }

  useEffect(() => {
    fetchPieces(currentPage)
  }, [currentPage, filterStatus])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchPieces(searchQuery)
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [searchQuery])

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
      const updatePieces = (pieces: PieceWithEditions[]) => 
        pieces.map(piece => ({
          ...piece,
          editions: piece.editions.map(e => 
            e._id === edition._id 
              ? { ...e, status: newStatus, reviewedAt: new Date().toISOString() }
              : e
          )
        }))

      setPieces(prevPieces => updatePieces(prevPieces))
      setSearchResults(prevResults => updatePieces(prevResults))
    } catch (err) {
      console.error('Error updating status:', err)
      setError('Failed to update edition status')
    } finally {
      setChangingStatus(null)
    }
  }

  const totalPages = Math.ceil(totalPieces / PIECES_PER_PAGE)
  const displayPieces = searchQuery ? searchResults : pieces

  if (loading && !isSearching) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  if (error) {
    return <div className="text-red-500">{error}</div>
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Review Pieces</h1>
        <Link 
          href="/reviewed" 
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          View Reviewed Pieces
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
          <option value="all">All Pieces</option>
          <option value="unreviewed">Unreviewed</option>
          <option value="reviewed">Reviewed</option>
        </select>
      </div>

      {!searchQuery && totalPages > 1 && (
        <div className="flex justify-center items-center space-x-2 mb-6">
          <button
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {currentPage + 1} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage >= totalPages - 1}
            className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      <div className="space-y-6">
        {displayPieces.map((piece) => (
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
                <span className={`px-2 py-1 rounded-full text-sm ${
                  piece.status === 'reviewed' ? 'bg-green-600 text-white' : 'bg-yellow-600 text-white'
                }`}>
                  {(piece.status || 'unreviewed').charAt(0).toUpperCase() + (piece.status || 'unreviewed').slice(1)}
                </span>
                {piece.status !== 'reviewed' && (
                  <button
                    onClick={async () => {
                      try {
                        const response = await fetch('/api/pieces', {
                          method: 'PATCH',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({
                            pieceId: piece._id,
                            status: 'reviewed',
                          }),
                        })

                        if (!response.ok) {
                          throw new Error('Failed to update piece status')
                        }

                        // Remove the piece from the list
                        setPieces(prevPieces => prevPieces.filter(p => p._id !== piece._id))
                        setSearchResults(prevResults => prevResults.filter(p => p._id !== piece._id))
                      } catch (err) {
                        console.error('Error updating piece status:', err)
                        setError('Failed to update piece status')
                      }
                    }}
                    className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Review Piece
                  </button>
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
                        {edition.status === 'unreviewed' && (
                          <>
                            <button
                              onClick={() => handleEditionStatusChange(edition, 'approved')}
                              disabled={changingStatus === edition._id}
                              className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleEditionStatusChange(edition, 'rejected')}
                              disabled={changingStatus === edition._id}
                              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {edition.status === 'approved' && (
                          <span className="text-green-400">Approved</span>
                        )}
                        {edition.status === 'rejected' && (
                          <div className="flex flex-col">
                            <span className="text-red-400">Rejected</span>
                            {edition.rejectionReason && (
                              <span className="text-sm text-red-400">Reason: {edition.rejectionReason}</span>
                            )}
                          </div>
                        )}
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