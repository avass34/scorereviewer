'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@sanity/client'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { Score } from '@/types/score'
import Link from 'next/link'
import debounce from 'lodash/debounce'

// Define error types
interface S3Error extends Error {
  code?: string;
  $metadata?: {
    requestId?: string;
  };
}

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  useCdn: false,
  apiVersion: '2024-02-20',
})

const BUCKET_NAME = 'tonebase-emails'
const REGION = 'us-east-1'
const APPROVED_PREFIX = 'Q2_2021/Q2W4/Scores/general'
const SCORES_PER_PAGE = 10

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

export default function ReviewPage() {
  const [scores, setScores] = useState<Score[]>([])
  const [searchResults, setSearchResults] = useState<Score[]>([])
  const [currentScoreIndex, setCurrentScoreIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [searchLoading, setSearchLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalScores, setTotalScores] = useState(0)
  const [rejectionReason, setRejectionReason] = useState('')
  const [pdfError, setPdfError] = useState<Error | null>(null)
  const [proxyUrl, setProxyUrl] = useState<string>('')
  const [scoreWindow, setScoreWindow] = useState<Window | null>(null)
  const [currentPdfUrl, setCurrentPdfUrl] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  const currentScore = scores[currentScoreIndex]
  const totalPages = Math.ceil(totalScores / SCORES_PER_PAGE)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Function to ensure window is open and navigate to URL
  const openScoreInWindow = (url: string) => {
    console.log('Opening score window with initial URL:', url)
    
    // Create a proxy HTML file that will help us get the final URL
    const proxyHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>Score Viewer</title></head>
      <body>
        <script>
        // Function to send URL back to parent
        function sendUrlToParent() {
          const currentUrl = window.location.href;
          console.log('Current URL in score window:', currentUrl);
          window.opener.postMessage({
            type: 'SCORE_URL_UPDATE',
            url: currentUrl
          }, '*');
        }

        // Set up interval to check URL changes
        const intervalId = setInterval(sendUrlToParent, 1000);
        console.log('Starting URL check interval');

        // Navigate to the score URL
        console.log('Navigating to:', "${url}");
        window.location.href = "${url}";
        </script>
        <div>Loading score...</div>
      </body>
      </html>
    `;

    console.log('Creating proxy page for URL:', url)
    
    // Create a blob URL for our proxy HTML
    const blob = new Blob([proxyHtml], { type: 'text/html' });
    const proxyUrl = URL.createObjectURL(blob);
    console.log('Created proxy URL:', proxyUrl)

    if (scoreWindow && !scoreWindow.closed) {
      console.log('Reusing existing window')
      scoreWindow.location.href = proxyUrl
      scoreWindow.focus()
    } else {
      console.log('Opening new window')
      const newWindow = window.open(proxyUrl, 'scoreWindow', 'width=800,height=600')
      if (newWindow) {
        console.log('New window created successfully')
        setScoreWindow(newWindow)
      } else {
        console.error('Failed to create new window')
      }
    }

    // Clean up the blob URL after use
    setTimeout(() => {
      console.log('Cleaning up proxy URL')
      URL.revokeObjectURL(proxyUrl)
    }, 1000);
  }

  // Set up message listener for URL updates
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      console.log('Received message:', event.data)
      
      if (event.data?.type === 'SCORE_URL_UPDATE') {
        const newUrl = event.data.url
        console.log('Processing URL update:', {
          previous: currentPdfUrl,
          new: newUrl,
          isChange: currentPdfUrl !== newUrl
        })
        
        if (newUrl !== currentPdfUrl) {
          console.log('Updating current PDF URL to:', newUrl)
          setCurrentPdfUrl(newUrl)
        }
      }
    }

    console.log('Setting up message listener')
    window.addEventListener('message', handleMessage)
    return () => {
      console.log('Cleaning up message listener')
      window.removeEventListener('message', handleMessage)
    }
  }, [currentPdfUrl])

  const fetchScores = async (page: number) => {
    try {
      setLoading(true)
      console.log('Fetching scores...', { page })
      
      // Build the GROQ query with pagination
      let query = '*[_type == "score" && status == "unreviewed"] | order(_createdAt asc)'
      
      // Get total count for pagination
      const countQuery = `count(${query})`
      const totalCount = await client.fetch<number>(countQuery)
      setTotalScores(totalCount)

      // Add pagination
      query += ` [${page * SCORES_PER_PAGE}...${(page + 1) * SCORES_PER_PAGE}]`

      const result = await client.fetch<Score[]>(query)
      console.log('Fetched scores:', result)
      
      setScores(result)
      setCurrentScoreIndex(0)
      
      // Open first score when loaded
      if (result.length > 0) {
        openScoreInWindow(result[0].scoreUrl)
      }
    } catch (err) {
      console.error('Error fetching scores:', err)
      setError('Failed to fetch scores')
    } finally {
      setLoading(false)
    }
  }

  // Debounced search function
  const searchScores = useCallback(
    debounce(async (search: string) => {
      if (!search.trim()) {
        setSearchResults([])
        setShowDropdown(false)
        return
      }

      try {
        setSearchLoading(true)
        const query = `*[_type == "score" && status == "unreviewed" && (
          pieceName match "*${search}*" || 
          composerName match "*${search}*"
        )] | order(_createdAt asc)[0...10]`
        
        const results = await client.fetch<Score[]>(query)
        setSearchResults(results)
        setShowDropdown(true)
      } catch (err) {
        console.error('Search error:', err)
      } finally {
        setSearchLoading(false)
      }
    }, 300),
    []
  )

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSearch = e.target.value
    setSearchQuery(newSearch)
    searchScores(newSearch)
  }

  // Handle selecting a score from search
  const handleScoreSelect = (score: Score) => {
    setScores([score])
    setCurrentScoreIndex(0)
    setShowDropdown(false)
    setSearchQuery('')
    openScoreInWindow(score.scoreUrl)
  }

  // Handle page change
  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
    fetchScores(newPage)
  }

  useEffect(() => {
    fetchScores(currentPage)
    return () => {
      searchScores.cancel()
    }
  }, [])

  const handlePreviousScore = () => {
    const newIndex = Math.max(0, currentScoreIndex - 1)
    setCurrentScoreIndex(newIndex)
    setRejectionReason('')
    if (scores[newIndex]) {
      openScoreInWindow(scores[newIndex].scoreUrl)
    }
  }

  const handleNextScore = () => {
    const newIndex = Math.min(scores.length - 1, currentScoreIndex + 1)
    setCurrentScoreIndex(newIndex)
    setRejectionReason('')
    if (scores[newIndex]) {
      openScoreInWindow(scores[newIndex].scoreUrl)
    }
  }

  // Clean up window on unmount
  useEffect(() => {
    return () => {
      if (scoreWindow) {
        scoreWindow.close()
      }
    }
  }, [scoreWindow])

  const handleApprove = async () => {
    console.log('Approve clicked. Current state:', {
      hasCurrentScore: !!currentScore,
      currentPdfUrl,
      scoreWindowExists: !!scoreWindow,
      scoreWindowClosed: scoreWindow?.closed
    })

    if (!currentScore) return

    // Immediately update UI and move to next score
    const scoreToProcess = currentScore
    setScores((prev) => prev.filter((_, i) => i !== currentScoreIndex))
    setCurrentScoreIndex((prev) => Math.min(prev, scores.length - 2))

    let newScoreUrl = scoreToProcess.scoreUrl // Default to original URL
    let updateError = null

    try {
      console.log('Starting approval process for:', {
        pieceName: scoreToProcess.pieceName,
        composerName: scoreToProcess.composerName,
        originalUrl: scoreToProcess.scoreUrl
      })

      // Process PDF using the new endpoint
      try {
        console.log('Sending score for PDF processing...')
        const processPdfResponse = await fetch('/api/process-pdf', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scoreUrl: scoreToProcess.scoreUrl,
            slug: scoreToProcess.slug.current,
          }),
        })

        if (!processPdfResponse.ok) {
          const errorData = await processPdfResponse.json()
          console.error('PDF processing failed:', {
            status: processPdfResponse.status,
            statusText: processPdfResponse.statusText,
            error: errorData
          })
          throw new Error(`Failed to process PDF: ${errorData.error}${errorData.details ? ` - ${errorData.details}` : ''}`)
        }

        const { url: processedUrl } = await processPdfResponse.json()
        console.log('PDF processed successfully:', processedUrl)
        newScoreUrl = processedUrl
      } catch (processError) {
        console.error('PDF processing failed:', processError)
        console.warn('Continuing with original URL:', scoreToProcess.scoreUrl)
        // Continue with original URL
      }

      // Update Sanity database
      console.log('Updating score status in database...')
      const updateResponse = await fetch('/api/scores', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scoreId: scoreToProcess._id,
          status: 'approved',
          scoreUrl: newScoreUrl,
          reviewedAt: new Date().toISOString(),
        }),
      })

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json()
        updateError = `Failed to update score status: ${errorData.error || updateResponse.statusText}`
        throw new Error(updateError)
      }

    } catch (error) {
      const err = error as Error
      console.error('Failed to process approval:', {
        error: err,
        errorMessage: err.message,
        errorStack: err.stack
      })
      setError(`Failed to process approval: ${err.message}`)
      
      // Restore the score in the list since we failed
      setScores(prev => {
        const newScores = [...prev]
        newScores.splice(currentScoreIndex, 0, scoreToProcess)
        return newScores
      })
    }

    // Always try to update Google Sheets, regardless of previous operations
    try {
      console.log('Adding score to Google Sheets...')
      const sheetsResponse = await fetch('/api/sheets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'add',
          score: {
            ...scoreToProcess,
            status: 'approved',
            scoreUrl: newScoreUrl,
          },
        }),
      })

      if (!sheetsResponse.ok) {
        const errorData = await sheetsResponse.json()
        console.error('Failed to add to Google Sheets:', {
          status: sheetsResponse.status,
          statusText: sheetsResponse.statusText,
          error: errorData
        })
        console.warn('Score approved but failed to add to Google Sheets')
      } else {
        console.log('Successfully added to Google Sheets')
      }
    } catch (sheetsError) {
      console.error('Error updating Google Sheets:', sheetsError)
      console.warn('Score approved but failed to add to Google Sheets')
    }

    // If there was an error in the main approval process, throw it now
    if (updateError) {
      throw new Error(updateError)
    }

    console.log('Score successfully approved and updated')
  }

  const handleReject = async () => {
    if (!currentScore) return

    // Immediately update UI and move to next score
    const scoreToProcess = currentScore
    const reasonToProcess = rejectionReason
    setScores((prev) => prev.filter((_, i) => i !== currentScoreIndex))
    setCurrentScoreIndex((prev) => Math.min(prev, scores.length - 2))
    setRejectionReason('')

    try {
      // Process rejection in the background
      const updateResponse = await fetch('/api/scores', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scoreId: scoreToProcess._id,
          status: 'rejected',
          rejectionReason: reasonToProcess,
          reviewedAt: new Date().toISOString(),
        }),
      })

      if (!updateResponse.ok) {
        throw new Error('Failed to update score status')
      }
    } catch (err) {
      console.error('Failed to process rejection:', err)
      // Optionally show a toast or notification about the background error
    }
  }

  useEffect(() => {
    if (currentScore?.scoreUrl) {
      // Use the proxy URL for the PDF viewer
      setProxyUrl(`/api/proxy?url=${encodeURIComponent(currentScore.scoreUrl)}`)
    }
  }, [currentScore])

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  if (error) {
    return <div className="text-red-500">{error}</div>
  }

  return (
    <div className="container mx-auto p-4 max-w-3xl">
      <div className="flex justify-between items-center mb-4">
        <div className="flex-1 max-w-md relative" ref={searchRef}>
          <div className="relative">
            <input
              type="text"
              placeholder="Search by piece name or composer..."
              className="w-full px-4 py-2 border rounded"
              value={searchQuery}
              onChange={handleSearchChange}
              onFocus={() => searchQuery && setShowDropdown(true)}
            />
            {searchLoading && (
              <div className="absolute right-3 top-2">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
              </div>
            )}
          </div>
          
          {/* Search Results Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-black border border-gray-700 rounded-md shadow-lg max-h-96 overflow-y-auto">
              {searchResults.map((score) => (
                <button
                  key={score._id}
                  className="w-full px-4 py-2 text-left hover:bg-gray-900 focus:outline-none focus:bg-gray-900"
                  onClick={() => handleScoreSelect(score)}
                >
                  <div className="font-medium text-white">{score.pieceName}</div>
                  <div className="text-sm text-gray-400">{score.composerName}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center space-x-4">
          <Link
            href="/reviewed"
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center space-x-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
            </svg>
            <span>View Reviewed Scores</span>
          </Link>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = '/auth';
            }}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 flex items-center space-x-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative">
        {loading && (
          <div className="absolute top-0 right-0 mt-2 mr-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && !searchQuery && (
          <div className="flex justify-center items-center space-x-2 mb-4">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 0}
              className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages - 1}
              className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}

        {/* Score Display or Empty State */}
        {!currentScore ? (
          <div className="border rounded p-4">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-400 mb-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <h2 className="text-2xl font-bold mb-2">No Scores Found</h2>
              <p className="text-gray-600 mb-6">
                {searchQuery 
                  ? `No scores match your search "${searchQuery}"`
                  : "There are no more scores waiting for review."}
              </p>
              <div className="flex space-x-4">
                <Link
                  href="/reviewed"
                  className="px-6 py-3 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center space-x-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                  </svg>
                  <span>View Reviewed Scores</span>
                </Link>
                <button
                  onClick={() => {
                    setSearchQuery('')
                    setCurrentPage(0)
                    fetchScores(0)
                  }}
                  className="px-6 py-3 bg-black-500 text-white rounded hover:bg-gray-600 flex items-center space-x-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                  </svg>
                  <span>Reset Search</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="border rounded p-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">Score Details</h2>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handlePreviousScore}
                  disabled={currentScoreIndex === 0}
                  className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                >
                  ← Previous Score
                </button>
                <span className="text-sm text-gray-600">
                  {currentScoreIndex + 1} of {scores.length}
                </span>
                <button
                  onClick={handleNextScore}
                  disabled={currentScoreIndex === scores.length - 1}
                  className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                >
                  Next Score →
                </button>
                <button
                  onClick={() => openScoreInWindow(currentScore.scoreUrl)}
                  className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center space-x-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                    <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                  </svg>
                  <span>Reopen Score</span>
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p><strong>Piece Name:</strong> {currentScore?.pieceName}</p>
                <p><strong>Composer:</strong> {currentScore?.composerName}</p>
                <p><strong>Editor:</strong> {currentScore?.editor}</p>
                <p><strong>Publisher:</strong> {currentScore?.publisher}</p>
                <p><strong>Language:</strong> {currentScore?.language}</p>
                <p><strong>Copyright:</strong> {currentScore?.copyright}</p>
              </div>

              <div className="mt-4">
                <textarea
                  className="w-full p-2 border rounded"
                  placeholder="Rejection reason (optional)"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                />
              </div>

              <div className="flex space-x-4 justify-center mt-4">
                <button
                  onClick={handleApprove}
                  className="px-6 py-3 bg-green-500 text-white rounded hover:bg-green-600"
                  disabled={loading}
                >
                  Approve
                </button>
                <button
                  onClick={handleReject}
                  className="px-6 py-3 bg-red-500 text-white rounded hover:bg-red-600"
                  disabled={loading}
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
} 