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
  const [searchQuery, setSearchQuery] = useState('')
  const [changingStatus, setChangingStatus] = useState<string | null>(null)
  const [selectedEdition, setSelectedEdition] = useState<Edition | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPieces, setTotalPieces] = useState(0)
  const [searchResults, setSearchResults] = useState<PieceWithEditions[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [editingField, setEditingField] = useState<{ editionId: string; field: string } | null>(null)
  const [editValue, setEditValue] = useState('')

  const fetchPieces = async (page: number) => {
    try {
      setLoading(true)
      console.log('Fetching pieces page:', page)

      // First get total count
      const countQuery = `count(*[_type == "piece" && status != "reviewed"])`
      const total = await client.fetch<number>(countQuery)
      setTotalPieces(total)

      // Then fetch the current page
      let query = `*[_type == "piece" && status != "reviewed"] | order(_createdAt desc) [$start...$end] {
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

  const searchPieces = async (query: string, page: number = 0) => {
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
      } | order(_createdAt desc)[$start...$end]`

      const results = await client.fetch<PieceWithEditions[]>(searchQuery, {
        start: page * PIECES_PER_PAGE,
        end: (page + 1) * PIECES_PER_PAGE
      })
      setSearchResults(results)
    } catch (err) {
      console.error('Error searching pieces:', err)
      setError('Failed to search pieces')
    } finally {
      setIsSearching(false)
    }
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
    if (!e.target.value.trim()) {
      setIsSearching(false)
      setSearchResults([])
    }
  }

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery) {
        setIsSearching(true)
        searchPieces(searchQuery, currentPage)
      } else {
        fetchPieces(currentPage)
      }
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [searchQuery, currentPage])

  const handleEditionStatusChange = async (edition: Edition, newStatus: Edition['status']) => {
    if (changingStatus === edition._id) return // Prevent multiple simultaneous changes
    
    try {
      setChangingStatus(edition._id)

      // Optimistically update the UI
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
    } catch (err) {
      console.error('Error updating status:', err)
      setError('Failed to update edition status')
      // Revert the optimistic update on error
      fetchPieces(currentPage)
    } finally {
      setChangingStatus(null)
    }
  }

  const handleEditStart = (editionId: string, field: string, currentValue: string) => {
    setEditingField({ editionId, field })
    setEditValue(currentValue)
  }

  const handleEditSave = async (editionId: string, field: string) => {
    try {
      const response = await fetch('/api/editions', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          editionId,
          [field]: editValue,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update edition')
      }

      // Update local state
      const updatePieces = (pieces: PieceWithEditions[]) =>
        pieces.map(piece => ({
          ...piece,
          editions: piece.editions.map(e =>
            e._id === editionId
              ? { ...e, [field]: editValue }
              : e
          )
        }))

      setPieces(prevPieces => updatePieces(prevPieces))
      setSearchResults(prevResults => updatePieces(prevResults))
    } catch (err) {
      console.error('Error updating edition:', err)
      setError('Failed to update edition')
    } finally {
      setEditingField(null)
    }
  }

  const handleEditCancel = () => {
    setEditingField(null)
  }

  const handleKeyPress = (e: React.KeyboardEvent, editionId: string, field: string) => {
    if (e.key === 'Enter') {
      handleEditSave(editionId, field)
    } else if (e.key === 'Escape') {
      handleEditCancel()
    }
  }

  const totalPages = Math.ceil(totalPieces / PIECES_PER_PAGE)
  const displayPieces = searchQuery ? searchResults : pieces

  if (loading && !isSearching && !searchQuery) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  if (error) {
    return <div className="text-red-500">{error}</div>
  }

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Review Pieces</h1>
          <p className="text-gray-400">Review and approve new editions</p>
        </div>
        <Link 
          href="/reviewed" 
          className="px-6 py-3 bg-[#e14f3d] text-white rounded-lg hover:bg-[#e14f3d]/90 transition-colors duration-200 flex items-center gap-2 cursor-pointer"
        >
          <span>View Reviewed Pieces</span>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </Link>
      </div>

      <div className="flex gap-4 mb-8">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Search pieces..."
            className="w-full px-6 py-4 bg-[#222222] border border-[#333333] rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#e14f3d] focus:border-transparent transition-all duration-200 cursor-text"
            value={searchQuery}
            onChange={handleSearchChange}
          />
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
        </div>
      </div>

      <div className="space-y-8 mb-8">
        {isSearching ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-gray-400">
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Searching...</span>
            </div>
          </div>
        ) : displayPieces.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            {searchQuery ? 'No pieces found matching your search.' : 'No pieces to review.'}
          </div>
        ) : (
          displayPieces.map((piece) => (
            <div key={piece._id} className="bg-[#222222] rounded-xl shadow-lg overflow-hidden border border-[#333333] hover:border-[#e14f3d]/50 transition-colors duration-200">
              <div className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-2">{piece.piece_title}</h2>
                    <div className="space-y-1">
                      <p className="text-gray-300">by {piece.composer}</p>
                      <p className="text-gray-400">
                        {piece.year_of_composition} • {piece.era}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`px-4 py-2 rounded-full text-sm font-medium ${
                      piece.status === 'reviewed' 
                        ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/50' 
                        : 'bg-amber-600/20 text-amber-400 border border-amber-600/50'
                    }`}>
                      {(piece.status || 'unreviewed').charAt(0).toUpperCase() + (piece.status || 'unreviewed').slice(1)}
                    </span>
                    {piece.status !== 'reviewed' && (
                      <button
                        onClick={async () => {
                          try {
                            setPieces(prevPieces => prevPieces.filter(p => p._id !== piece._id))
                            setSearchResults(prevResults => prevResults.filter(p => p._id !== piece._id))

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
                          } catch (err) {
                            console.error('Error updating piece status:', err)
                            setError('Failed to update piece status')
                            fetchPieces(currentPage)
                          }
                        }}
                        className="px-6 py-3 bg-[#e14f3d] text-white rounded-lg hover:bg-[#e14f3d]/90 transition-colors duration-200 flex items-center gap-2 cursor-pointer"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Review Piece
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Editions</h3>
                  <div className="space-y-4">
                    {piece.editions.map((edition) => (
                      <div key={edition._id} className="bg-[#333333] rounded-lg p-6 border border-[#222222] hover:border-[#e14f3d]/50 transition-colors duration-200">
                        <div className="flex items-start justify-between">
                          <div className="space-y-4 flex-1">
                            <div>
                              <div className="text-sm text-gray-400 mb-1">Publisher:</div>
                              {editingField?.editionId === edition._id && editingField?.field === 'publisher' ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={(e) => handleKeyPress(e, edition._id, 'publisher')}
                                    className="px-3 py-2 bg-[#222222] border border-[#333333] rounded text-white focus:outline-none focus:ring-2 focus:ring-[#e14f3d] focus:border-transparent"
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => handleEditSave(edition._id, 'publisher')}
                                    className="px-3 py-2 bg-[#e14f3d] text-white rounded hover:bg-[#e14f3d]/90 transition-colors duration-200 cursor-pointer"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={handleEditCancel}
                                    className="px-3 py-2 bg-[#333333] text-white rounded hover:bg-[#222222] transition-colors duration-200 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-white">{edition.publisher || 'Not specified'}</span>
                                  <button
                                    onClick={() => handleEditStart(edition._id, 'publisher', edition.publisher || '')}
                                    className="text-gray-400 hover:text-[#e14f3d] transition-colors duration-200 cursor-pointer"
                                  >
                                    ✏️
                                  </button>
                                </div>
                              )}
                            </div>
                            
                            {edition.editor && (
                              <div>
                                <div className="text-sm text-gray-400 mb-1">Editor:</div>
                                {editingField?.editionId === edition._id && editingField?.field === 'editor' ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onKeyDown={(e) => handleKeyPress(e, edition._id, 'editor')}
                                      className="px-3 py-2 bg-[#222222] border border-[#333333] rounded text-white focus:outline-none focus:ring-2 focus:ring-[#e14f3d] focus:border-transparent"
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleEditSave(edition._id, 'editor')}
                                      className="px-3 py-2 bg-[#e14f3d] text-white rounded hover:bg-[#e14f3d]/90 transition-colors duration-200 cursor-pointer"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={handleEditCancel}
                                      className="px-3 py-2 bg-[#333333] text-white rounded hover:bg-[#222222] transition-colors duration-200 cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span className="text-white">{edition.editor}</span>
                                    <button
                                      onClick={() => handleEditStart(edition._id, 'editor', edition.editor)}
                                      className="text-gray-400 hover:text-[#e14f3d] transition-colors duration-200 cursor-pointer"
                                    >
                                      ✏️
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {edition.copyright && (
                              <p className="text-sm text-gray-400">© {edition.copyright}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-4 ml-6">
                            {edition.url && (
                              <button
                                onClick={() => window.open(edition.url, 'scoreWindow', 'width=800,height=600')}
                                className="text-[#e14f3d] hover:text-[#e14f3d]/80 transition-colors duration-200 flex items-center gap-2 cursor-pointer"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                                </svg>
                                View Edition
                              </button>
                            )}
                            
                            <div className="flex items-center gap-3">
                              {edition.status === 'unreviewed' && (
                                <>
                                  <button
                                    onClick={() => handleEditionStatusChange(edition, 'approved')}
                                    disabled={changingStatus === edition._id}
                                    className="px-4 py-2 bg-[#e14f3d] text-white rounded-lg hover:bg-[#e14f3d]/90 disabled:opacity-50 disabled:hover:bg-[#e14f3d] transition-colors duration-200 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => handleEditionStatusChange(edition, 'rejected')}
                                    disabled={changingStatus === edition._id}
                                    className="px-4 py-2 bg-[#333333] text-white rounded-lg hover:bg-[#222222] disabled:opacity-50 disabled:hover:bg-[#333333] transition-colors duration-200 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                    </svg>
                                    Reject
                                  </button>
                                </>
                              )}
                              {edition.status === 'approved' && (
                                <div className="flex items-center gap-3">
                                  <div className="px-4 py-2 bg-[#e14f3d]/20 text-[#e14f3d] rounded-lg border border-[#e14f3d]/50 flex items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                    Approved
                                  </div>
                                  {edition.reviewedAt && (
                                    <span className="text-sm text-gray-400">
                                      {new Date(edition.reviewedAt).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                              )}
                              {edition.status === 'rejected' && (
                                <div className="flex flex-col items-end gap-1">
                                  <div className="px-4 py-2 bg-[#333333]/20 text-[#e14f3d] rounded-lg border border-[#e14f3d]/50 flex items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                    </svg>
                                    Rejected
                                  </div>
                                  {edition.rejectionReason && (
                                    <span className="text-sm text-[#e14f3d]">Reason: {edition.rejectionReason}</span>
                                  )}
                                </div>
                              )}
                              {changingStatus === edition._id && (
                                <div className="flex items-center gap-2 text-gray-400">
                                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  <span>Updating...</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {!searchQuery && totalPages > 1 && (
        <div className="flex justify-center items-center space-x-4 mt-8">
          <button
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="px-4 py-2 bg-[#333333] text-white rounded-lg hover:bg-[#222222] disabled:opacity-50 disabled:hover:bg-[#333333] transition-colors duration-200 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Previous
          </button>
          <span className="text-gray-400">
            Page {currentPage + 1} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage >= totalPages - 1}
            className="px-4 py-2 bg-[#333333] text-white rounded-lg hover:bg-[#222222] disabled:opacity-50 disabled:hover:bg-[#333333] transition-colors duration-200 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
          >
            Next
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
} 