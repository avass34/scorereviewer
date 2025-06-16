import { createClient } from '@sanity/client'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

interface SanityDocument {
  _id: string
  _type: string
}

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
  apiVersion: '2024-02-20',
})

async function deleteScoresInBatches(scores: SanityDocument[], batchSize: number = 100) {
  let deleted = 0
  for (let i = 0; i < scores.length; i += batchSize) {
    const batch = scores.slice(i, i + batchSize)
    const transaction = client.transaction()
    
    batch.forEach((score: SanityDocument) => {
      transaction.delete(score._id)
    })

    try {
      await transaction.commit()
      deleted += batch.length
      console.log(`Deleted ${deleted}/${scores.length} scores`)
    } catch (error) {
      console.error(`Error deleting batch starting at index ${i}:`, error)
      // Continue with next batch even if this one fails
    }
  }
  return deleted
}

async function deleteAllScores() {
  try {
    // First, fetch all scores
    const scores = await client.fetch<SanityDocument[]>(`*[_type == "score"]`)
    console.log(`Found ${scores.length} existing scores`)

    if (scores.length === 0) {
      console.log('No scores to delete')
      return
    }

    // Delete in batches
    const deleted = await deleteScoresInBatches(scores)
    console.log(`Successfully deleted ${deleted} scores`)
  } catch (error) {
    console.error('Error fetching scores:', error)
  }
}

// Run the deletion
deleteAllScores() 