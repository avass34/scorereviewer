'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@sanity/client'
import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { pdfjs, Document as PDFDocument, Page } from 'react-pdf'
import { Score } from '@/types/score'

// Initialize PDF.js worker
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
}

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  useCdn: false,
  token: process.env.SANITY_API_TOKEN,
  apiVersion: '2024-02-20',
})

const BUCKET_NAME = 'tonebase-general-client'
const REGION = 'us-east-1'
const UNREVIEWED_PREFIX = 'editions/unreviewed'
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

  const currentScore = scores[currentScoreIndex]

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
    } catch (err) {
      console.error('Error fetching scores:', err)
      setError('Failed to fetch scores')
    } finally {
      setLoading(false)
    }
  }

  const handlePreviousScore = () => {
    setCurrentScoreIndex((prev) => Math.max(0, prev - 1))
    setPageNumber(1) // Reset PDF page when changing scores
    setRejectionReason('') // Clear rejection reason
  }

  const handleNextScore = () => {
    setCurrentScoreIndex((prev) => Math.min(scores.length - 1, prev + 1))
    setPageNumber(1) // Reset PDF page when changing scores
    setRejectionReason('') // Clear rejection reason
  }

  const handleApprove = async () => {
    if (!currentScore) return

    try {
      setLoading(true)

      const oldKey = new URL(currentScore.scoreUrl).pathname.slice(1)
      const fileName = oldKey.split('/').pop()
      const newKey = `${APPROVED_PREFIX}/${fileName}`

      await s3Client.send(
        new CopyObjectCommand({
          Bucket: BUCKET_NAME,
          CopySource: `${BUCKET_NAME}/${oldKey}`,
          Key: newKey,
        })
      )

      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: oldKey,
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
    <div className="container mx-auto p-4">
      <div className="grid grid-cols-2 gap-4">
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
            </div>
          </div>

          <div className="space-y-2">
            <p><strong>Piece Name:</strong> {currentScore.pieceName}</p>
            <p><strong>Composer:</strong> {currentScore.composerName}</p>
            <p><strong>Editor:</strong> {currentScore.editor}</p>
            <p><strong>Publisher:</strong> {currentScore.publisher}</p>
            <p><strong>Language:</strong> {currentScore.language}</p>
            <p><strong>Copyright:</strong> {currentScore.copyright}</p>
          </div>

          <div className="mt-4">
            <textarea
              className="w-full p-2 border rounded"
              placeholder="Rejection reason (optional)"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </div>

          <div className="flex space-x-4 mt-4">
            <button
              onClick={handleApprove}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              disabled={loading}
            >
              Approve
            </button>
            <button
              onClick={handleReject}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
              disabled={loading}
            >
              Reject
            </button>
          </div>
        </div>

        <div className="border rounded p-4">
          <PDFDocument
            file={currentScore.scoreUrl}
            onLoadSuccess={({ numPages }) => {
              console.log('PDF loaded successfully:', currentScore.scoreUrl)
              setNumPages(numPages)
              setPdfError(null)
            }}
            onLoadError={(error) => {
              console.error('Error loading PDF:', error, 'URL:', currentScore.scoreUrl)
              setPdfError(error)
            }}
            loading={
              <div className="flex items-center justify-center h-[600px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              </div>
            }
            error={
              <div className="flex items-center justify-center h-[600px] text-red-500">
                Failed to load PDF. Please check if the URL is accessible.
              </div>
            }
          >
            <Page 
              pageNumber={pageNumber} 
              loading={
                <div className="flex items-center justify-center h-[600px]">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                </div>
              }
              error={
                <div className="flex items-center justify-center h-[600px] text-red-500">
                  Failed to load page {pageNumber}.
                </div>
              }
            />
          </PDFDocument>
          
          {numPages && !pdfError && (
            <div className="flex justify-between items-center mt-4">
              <button
                onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
                disabled={pageNumber <= 1}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              >
                Previous
              </button>
              <span>
                Page {pageNumber} of {numPages}
              </span>
              <button
                onClick={() => setPageNumber(Math.min(numPages, pageNumber + 1))}
                disabled={pageNumber >= numPages}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 