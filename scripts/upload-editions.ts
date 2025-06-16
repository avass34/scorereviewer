import {createClient} from '@sanity/client'
import {parse} from 'csv-parse/sync'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import crypto from 'crypto'

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' })

// Initialize Sanity client
const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: 'production',
  apiVersion: '2024-03-19',
  token: process.env.SANITY_API_TOKEN!,
  useCdn: false,
})

function safeId(slug: string) {
  let id = slug
    .replace(/[^a-zA-Z0-9-_]/g, '-') // replace invalid chars with dash
    .replace(/-+/g, '-') // collapse multiple dashes
    .replace(/^[-_]+|[-_]+$/g, ''); // remove leading/trailing dashes/underscores

  // If id is too long, use a hash for uniqueness
  if (id.length > 100) {
    const hash = crypto.createHash('sha1').update(slug).digest('hex').slice(0, 8);
    id = id.slice(0, 100) + '-' + hash;
  }
  if (!id) id = Math.random().toString(36).slice(2, 10); // fallback if empty
  return 'edition-' + id;
}

async function deleteAllEditions() {
  console.log('Deleting all existing editions...')
  const query = `*[_type == "edition"]`
  const existingEditions = await client.fetch(query)
  console.log(`Found ${existingEditions.length} existing editions to delete`)

  // Delete in batches of 50
  const batchSize = 50
  for (let i = 0; i < existingEditions.length; i += batchSize) {
    const batch = existingEditions.slice(i, i + batchSize)
    console.log(`Deleting batch ${Math.floor(i / batchSize) + 1}...`)
    
    const transaction = client.transaction()
    batch.forEach((doc: any) => {
      transaction.delete(doc._id)
    })
    
    await transaction.commit()
    console.log(`Deleted batch ${Math.floor(i / batchSize) + 1} successfully`)
  }
  console.log('Successfully deleted all existing editions')
}

async function uploadEditions() {
  console.log('Starting edition upload...')
  
  // Read and parse CSV
  const csvPath = path.join(process.cwd(), 'data', 'editions.csv')
  console.log(`Reading CSV file from: ${csvPath}`)
  const fileContent = fs.readFileSync(csvPath, 'utf-8')
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  })
  console.log('CSV file read successfully')
  console.log(`Found ${records.length} editions to upload`)
  
  // Log first row for verification
  console.log('First row sample:', records[0])

  // Process in batches of 50
  const batchSize = 50
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1} (${i + 1} to ${Math.min(i + batchSize, records.length)} of ${records.length})`)
    
    const transaction = client.transaction()
    
    for (const row of batch) {
      const doc = {
        _id: safeId(row.slug),
        _type: 'edition',
        slug: {
          _type: 'slug',
          current: row.slug,
        },
        publisher: row.publisher || undefined,
        copyright: row.copyright || undefined,
        editor: row.editor || undefined,
        url: row.url || undefined,
        piece: {
          _type: 'reference',
          _ref: `piece-${row.piece_slug}`,
        },
      }
      transaction.create(doc)
    }
    
    console.log(`Committing batch ${Math.floor(i / batchSize) + 1}...`)
    const result = await transaction.commit()
    console.log(`Batch ${Math.floor(i / batchSize) + 1} committed successfully:`, result)
    console.log(`Processed ${Math.min(i + batchSize, records.length)}/${records.length} editions`)
  }
  
  console.log(`Successfully imported ${records.length} editions`)
}

async function main() {
  console.log('Script starting...')
  await deleteAllEditions()
  await uploadEditions()
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
}) 