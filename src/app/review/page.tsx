'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@sanity/client'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { Score } from '@/types/score'

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  useCdn: false,
  token: process.env.SANITY_API_TOKEN,
  apiVersion: '2024-02-20',
})

const BUCKET_NAME = 'tonebase-general-client'
const REGION = 'us-east-1'
const APPROVED_PREFIX = 'editions/approved'

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

export default function ReviewPage() {
  const [scores, setScores] = useState<Score[]>([])
  const [currentScoreIndex, setCurrentScoreIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [rejectionReason, setRejectionReason] = useState('')
  const [pdfError, setPdfError] = useState<Error | null>(null)
  const [proxyUrl, setProxyUrl] = useState<string>('')
  const [scoreWindow, setScoreWindow] = useState<Window | null>(null)

  const currentScore = scores[currentScoreIndex]

  // Function to ensure window is open and navigate to URL
  const openScoreInWindow = (url: string) => {
    if (scoreWindow && !scoreWindow.closed) {
      // If we have a window and it's not closed, navigate it
      scoreWindow.location.href = url
      scoreWindow.focus()
    } else {
      // Create new window
      const newWindow = window.open(url, 'scoreWindow', 'width=800,height=600')
      if (newWindow) {
        setScoreWindow(newWindow)
      }
    }
  }

  useEffect(() => {
    fetchScores()
  }, [])

  const fetchScores = async () => {
    try {
      setLoading(true)
      console.log('Fetching scores...')
      const result = await client.fetch<Score[]>(
        `*[_type == "score" && status == "unreviewed"] | order(_createdAt asc)`
      )
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
    if (!currentScore) return

    try {
      setLoading(true)

      // Download the PDF through our proxy
      const response = await fetch(`/api/proxy?url=${encodeURIComponent(currentScore.scoreUrl)}`)
      if (!response.ok) throw new Error('Failed to download PDF')
      const pdfBlob = await response.blob()

      // Generate the new key using the slug
      const fileName = `${currentScore.slug.current}.pdf`
      const newKey = `${APPROVED_PREFIX}/${fileName}`

      // Upload to S3
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: newKey,
          Body: pdfBlob,
          ContentType: 'application/pdf',
        })
      )

      const newScoreUrl = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${newKey}`
      await client
        .patch(currentScore._id)
        .set({
          status: 'approved',
          scoreUrl: newScoreUrl,
          reviewedAt: new Date().toISOString(),
        })
        .commit()

      // Remove the approved score and update the index
      setScores((prev) => prev.filter((_, i) => i !== currentScoreIndex))
      setCurrentScoreIndex((prev) => Math.min(prev, scores.length - 2))
    } catch (err) {
      setError('Failed to approve score')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    if (!currentScore) return

    try {
      setLoading(true)

      await client
        .patch(currentScore._id)
        .set({
          status: 'rejected',
          ...(rejectionReason && { rejectionReason }),
          reviewedAt: new Date().toISOString(),
        })
        .commit()

      // Remove the rejected score and update the index
      setScores((prev) => prev.filter((_, i) => i !== currentScoreIndex))
      setCurrentScoreIndex((prev) => Math.min(prev, scores.length - 2))
      setRejectionReason('')
    } catch (err) {
      setError('Failed to reject score')
      console.error(err)
    } finally {
      setLoading(false)
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

  if (!currentScore) {
    return <div>No more scores to review!</div>
  }

  return (
    <div className="container mx-auto p-4 max-w-3xl">
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
            {currentScore && (
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
            )}
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
    </div>
  )
} 