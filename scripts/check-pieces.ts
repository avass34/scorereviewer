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

async function checkPieces() {
  try {
    const query = `*[_type == "piece"] {
      _id,
      piece_title,
      composer,
      year_of_composition,
      era,
      "slug": slug.current
    }`
    
    const pieces = await client.fetch(query)
    console.log(`Found ${pieces.length} pieces in Sanity`)
    
    if (pieces.length > 0) {
      console.log('\nFirst 5 pieces:')
      pieces.slice(0, 5).forEach((piece: any) => {
        console.log(JSON.stringify(piece, null, 2))
      })
    }
  } catch (error) {
    console.error('Error checking pieces:', error)
  }
}

checkPieces() 