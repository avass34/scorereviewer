import { createClient } from '@sanity/client'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
  apiVersion: '2024-02-20',
})

async function checkScores() {
  try {
    const query = `*[_type == "score"] {
      _id,
      title,
      composer,
      year_of_composition,
      era,
      "slug": slug.current
    }`
    
    const scores = await client.fetch(query)
    console.log(`Found ${scores.length} scores in Sanity`)
    
    if (scores.length > 0) {
      console.log('\nFirst 5 scores:')
      scores.slice(0, 5).forEach((score: any) => {
        console.log(JSON.stringify(score, null, 2))
      })
    }
  } catch (error) {
    console.error('Error checking scores:', error)
  }
}

checkScores() 