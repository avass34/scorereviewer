'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@sanity/client'
import { Score, ScoreStatus } from '@/types/score'
import Link from 'next/link'

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  useCdn: false,
  apiVersion: '2024-02-20',
})

type FilterStatus = 'approved' | 'rejected' | 'all'

export default function ReviewedScoresPage() {
  const [scores, setScores] = useState<Score[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [changingStatus, setChangingStatus] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')

  const fetchScores = async () => {
    try {
      setLoading(true)
      let query = '*[_type == "score" && (status == "approved" || status == "rejected")'

      // Add search filter if there's a search query
      if (searchQuery) {
        query += ` && (
          pieceName match "*${searchQuery}*" ||
          composerName match "*${searchQuery}*" ||
          editor match "*${searchQuery}*" ||
          publisher match "*${searchQuery}*"
        )`
      }

      // Add status filter if not 'all'
      if (filterStatus !== 'all') {
        query += ` && status == "${filterStatus}"`
      }

      query += '] | order(reviewedAt desc)'

      const result = await client.fetch<Score[]>(query)
      setScores(result)
    } catch (err) {
      console.error('Error fetching scores:', err)
      setError('Failed to fetch scores')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchScores()
  }, [filterStatus, searchQuery])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }

  const handleStatusChange = async (score: Score, newStatus: ScoreStatus) => {
    if (changingStatus === score._id) return // Prevent multiple simultaneous changes
    
    try {
      setChangingStatus(score._id)
      
      // If changing to rejected, prompt for reason
      let reason = undefined
      if (newStatus === 'rejected') {
        reason = window.prompt('Please enter a rejection reason:')
        if (reason === null) return // User cancelled
      }

      const response = await fetch('/api/scores', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scoreId: score._id,
          status: newStatus,
          rejectionReason: reason,
          reviewedAt: new Date().toISOString(),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update score status')
      }

      // Update Google Sheets based on status change
      if (score.status === 'approved') {
        // Always remove from sheet if the score was previously approved
        await fetch('/api/sheets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'remove',
            score,
          }),
        })
      }
      
      if (newStatus === 'approved') {
        // Add to sheet if changing to approved
        await fetch('/api/sheets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'add',
            score: {
              ...score,
              status: newStatus,
              rejectionReason: reason,
            },
          }),
        })
      }

      // Update the score in the local state
      setScores(prevScores => 
        prevScores.map(s => 
          s._id === score._id 
            ? { ...s, status: newStatus, rejectionReason: reason }
            : s
        )
      )
    } catch (err) {
      console.error('Error updating status:', err)
      setError('Failed to update score status')
    } finally {
      setChangingStatus(null)
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
        <h1 className="text-2xl font-bold">Reviewed Scores</h1>
        <Link 
          href="/review" 
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Review New Scores
        </Link>
      </div>

      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search scores..."
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
          <option value="all">All Reviews</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="bg-black rounded-lg shadow">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-900">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Piece Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Composer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Editor</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Publisher</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Reviewed At</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-black divide-y divide-gray-800">
              {scores.map((score) => (
                <tr key={score._id} className="hover:bg-gray-900">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        score.status === 'approved' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                      }`}>
                        {score.status.charAt(0).toUpperCase() + score.status.slice(1)}
                      </span>
                      <select
                        value={score.status}
                        onChange={(e) => handleStatusChange(score, e.target.value as ScoreStatus)}
                        disabled={changingStatus === score._id}
                        className="bg-gray-800 text-gray-300 text-sm rounded border border-gray-700 px-2 py-1"
                      >
                        <option value="approved">Set Approved</option>
                        <option value="rejected">Set Rejected</option>
                        <option value="unreviewed">Set Unreviewed</option>
                      </select>
                      {changingStatus === score._id && (
                        <span className="text-gray-400 text-sm">Updating...</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-300">{score.pieceName}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-300">{score.composerName}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-300">{score.editor}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-300">{score.publisher}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-300">
                    {score.reviewedAt ? new Date(score.reviewedAt).toLocaleDateString() : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col space-y-2">
                      <button
                        onClick={() => window.open(score.scoreUrl, 'scoreWindow', 'width=800,height=600')}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        View Score
                      </button>
                      {score.status === 'rejected' && score.rejectionReason && (
                        <div className="text-sm text-red-400">
                          Reason: {score.rejectionReason}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
} 