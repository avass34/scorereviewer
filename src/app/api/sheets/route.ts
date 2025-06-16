import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { JWT } from 'google-auth-library'

// Queue system for processing approvals
class ApprovalQueue {
  private queue: Array<() => Promise<void>> = []
  private processing = false

  async add(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await task()
          resolve()
        } catch (error) {
          reject(error)
        }
      })
      this.processQueue()
    })
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return
    
    this.processing = true
    try {
      const task = this.queue.shift()
      if (task) {
        await task()
      }
    } finally {
      this.processing = false
      if (this.queue.length > 0) {
        await this.processQueue()
      }
    }
  }
}

const approvalQueue = new ApprovalQueue()

// Define error type for Google API errors
interface GoogleAPIError extends Error {
  response?: {
    status: number;
    statusText: string;
    data: any;
  };
}

// Validate environment variables
const requiredEnvVars = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID
}

// Check for missing environment variables
const missingEnvVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value)
  .map(([key]) => key)

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars)
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
}

// Initialize Google Sheets client
const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

console.log('Sheets API initialized with email:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL)

const sheets = google.sheets({ version: 'v4', auth })
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID
const APPROVED_EDITIONS_SHEET = 'Approved Editions'
const PIECES_SHEET = 'Pieces'

console.log('Using spreadsheet ID:', SPREADSHEET_ID)

// Cache for sheet ID
let sheetId: number | null = null

// Helper function to create a slug from composer name and piece name
function createSlug(composerName: string, pieceName: string): string {
  return `${composerName}-${pieceName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric chars with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
}

// Helper function to get sheet ID
async function getSheetId(sheetName: string): Promise<number> {
  if (sheetId !== null) return sheetId

  try {
    console.log(`Fetching sheet ID for: "${sheetName}"`)
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    })

    console.log('Spreadsheet details:', {
      title: response.data.properties?.title,
      sheets: response.data.sheets?.map(s => s.properties?.title),
    })

    const sheet = response.data.sheets?.find(
      (s) => s.properties?.title === sheetName
    )

    if (!sheet?.properties?.sheetId) {
      console.error(`Sheet "${sheetName}" not found`)
      throw new Error(`Sheet "${sheetName}" not found`)
    }

    sheetId = sheet.properties.sheetId
    console.log(`Found sheet ID: ${sheetId}`)
    return sheetId
  } catch (error) {
    console.error(`Error getting sheet ID for "${sheetName}":`, error)
    throw error
  }
}

async function ensureSheetExists(sheetName: string, headers: string[]) {
  try {
    console.log(`Checking if sheet "${sheetName}" exists...`)
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
    })
    
    if (headerResponse.data.values) {
      console.log(`Sheet "${sheetName}" exists, headers:`, headerResponse.data.values[0])
      return
    }
  } catch (error) {
    console.log(`Sheet "${sheetName}" does not exist, will create it`)
  }

  try {
    console.log(`Creating new sheet "${sheetName}"...`)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: sheetName,
            },
          },
        }],
      },
    })

    console.log(`Adding headers to "${sheetName}":`, headers)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    })
    console.log('Headers added successfully')
  } catch (error) {
    console.error(`Error creating sheet "${sheetName}":`, error)
    throw error
  }
}

async function findPieceBySlug(slug: string): Promise<number | null> {
  try {
    console.log('Looking for piece with slug:', slug)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PIECES_SHEET}'!A:E`,
    })

    if (!response.data.values) {
      console.log('No values found in sheet')
      return null
    }

    // Get all rows including header
    const allRows = response.data.values
    console.log('Total rows in sheet:', allRows.length)

    // Find the row with exact slug match (case sensitive)
    for (let i = 1; i < allRows.length; i++) {
      const row = allRows[i]
      if (row && row[0] === slug) {
        console.log('Found existing piece at row:', i + 1, 'Row data:', row)
        return i + 1 // Return 1-based row number
      }
    }

    console.log('No existing piece found for slug:', slug)
    return null
  } catch (error) {
    console.error('Error finding piece by slug:', error)
    throw error
  }
}

async function addPieceIfNotExists(score: any): Promise<string> {
  const slug = createSlug(score.composerName, score.pieceName)
  
  try {
    // First check if piece exists - do this in a loop to handle race conditions
    let retries = 0
    const maxRetries = 3
    let existingRowIndex: number | null = null

    while (retries < maxRetries) {
      existingRowIndex = await findPieceBySlug(slug)
      
      if (existingRowIndex !== null) {
        console.log('Piece already exists with slug:', slug, 'at row:', existingRowIndex)
        return slug
      }

      // If we get here, the piece doesn't exist. Let's try to add it.
      try {
        // Only generate summary for new pieces
        let summary = score.summary || ''
        if (!summary) {
          try {
            console.log('Attempting to generate summary for new piece:', {
              pieceName: score.pieceName,
              composerName: score.composerName
            })
            
            const baseUrl = process.env.VERCEL_URL 
              ? `https://${process.env.VERCEL_URL}` 
              : process.env.NODE_ENV === 'development'
                ? 'http://localhost:3000'
                : ''
            
            const summaryResponse = await fetch(`${baseUrl}/api/generate-summary`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                pieceName: score.pieceName,
                composerName: score.composerName,
              }),
            })

            if (summaryResponse.ok) {
              const data = await summaryResponse.json()
              summary = data.summary
              console.log('Generated summary for new piece:', summary)
              
              // Update Sanity with the summary
              await fetch('/api/scores', {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  scoreId: score._id,
                  summary: summary,
                }),
              })
            } else {
              console.error('Failed to generate summary:', await summaryResponse.text())
            }
          } catch (error) {
            console.error('Error generating summary for new piece:', error)
          }
        }

        // Check one more time before adding to handle race conditions
        const finalCheck = await findPieceBySlug(slug)
        if (finalCheck !== null) {
          console.log('Piece was added by another process, using existing piece')
          return slug
        }

        // Add new piece with generated or existing summary
        const pieceRow = [
          slug,               // Slug
          score.pieceName,    // Piece Name
          score.composerName, // Composer
          score.language,     // Language
          summary,           // Summary
        ]

        console.log('Adding new piece row:', pieceRow)

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${PIECES_SHEET}'!A:E`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [pieceRow],
          },
        })

        console.log('Successfully added new piece')
        return slug
      } catch (error) {
        console.error(`Error adding piece (attempt ${retries + 1}):`, error)
        retries++
        if (retries === maxRetries) {
          throw error
        }
        // Wait a short time before retrying
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    throw new Error('Failed to add piece after maximum retries')
  } catch (error) {
    console.error('Error in addPieceIfNotExists:', error)
    throw error
  }
}

async function removeDuplicatePiece(slug: string) {
  try {
    console.log('Checking for duplicate piece:', slug)
    
    // Get all values in the sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PIECES_SHEET}'!A:F`,
    })

    if (!response.data.values) {
      console.log('No values found in sheet')
      return
    }

    // Find the row index of the duplicate (skip header row)
    const duplicateRowIndex = response.data.values.findIndex((row, index) => 
      index > 0 && row[0] === slug
    )

    if (duplicateRowIndex === -1) {
      console.log('No duplicate found')
      return
    }

    console.log('Found duplicate at row:', duplicateRowIndex + 1)

    // Delete the duplicate row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: await getSheetId(PIECES_SHEET),
              dimension: 'ROWS',
              startIndex: duplicateRowIndex,
              endIndex: duplicateRowIndex + 1
            }
          }
        }]
      }
    })

    console.log('Successfully removed duplicate')
  } catch (error) {
    console.error('Error removing duplicate piece:', error)
    throw error
  }
}

async function addPieceToSheet(piece: any) {
  try {
    if (!piece || !piece.slug || !piece.slug.current) {
      throw new Error('Invalid piece data: missing required fields')
    }

    console.log('Adding piece:', {
      id: piece._id,
      title: piece.piece_title,
      composer: piece.composer,
      year: piece.year_of_composition,
      era: piece.era,
      slug: piece.slug.current
    })

    // Remove any existing duplicate before adding
    await removeDuplicatePiece(piece.slug.current)

    // Generate summary if not exists
    let summary = piece.summary
    if (!summary) {
      try {
        console.log('Generating summary for piece:', piece.piece_title)
        const baseUrl = process.env.VERCEL_URL 
          ? `https://${process.env.VERCEL_URL}` 
          : process.env.NODE_ENV === 'development'
            ? 'http://localhost:3000'
            : ''
        
        const summaryResponse = await fetch(`${baseUrl}/api/generate-summary`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pieceName: piece.piece_title,
            composerName: piece.composer,
          }),
        })

        if (summaryResponse.ok) {
          const data = await summaryResponse.json()
          summary = data.summary
          console.log('Generated summary:', summary)
          
          // Update Sanity with the summary
          await fetch('/api/pieces', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              pieceId: piece._id,
              summary: summary,
            }),
          })
        } else {
          console.error('Failed to generate summary:', await summaryResponse.text())
        }
      } catch (error) {
        console.error('Error generating summary:', error)
      }
    }

    const pieceRow = [
      piece.slug.current,     // Slug
      piece.piece_title || '',      // Piece Title
      piece.composer || '',         // Composer
      piece.year_of_composition || '', // Year
      piece.era || '',              // Era
      summary || '',          // Summary
    ]

    console.log('Appending piece row to sheet:', pieceRow)

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PIECES_SHEET}'!A:F`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [pieceRow],
      },
    })

    if (!response.data) {
      throw new Error('No response data from sheets API')
    }

    console.log('Successfully added piece:', response.data)
    return response.data
  } catch (error) {
    console.error('Error adding piece:', error)
    if (error instanceof Error) {
      throw new Error(`Failed to add piece: ${error.message}`)
    }
    throw error
  }
}

async function removeDuplicateEdition(editionSlug: string) {
  try {
    console.log('Checking for duplicate edition:', editionSlug)
    
    // Get all values in the sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${APPROVED_EDITIONS_SHEET}'!A:G`,
    })

    if (!response.data.values) {
      console.log('No values found in sheet')
      return
    }

    // Find the row index of the duplicate (skip header row)
    const duplicateRowIndex = response.data.values.findIndex((row, index) => 
      index > 0 && row[1] === editionSlug // Edition slug is in column B
    )

    if (duplicateRowIndex === -1) {
      console.log('No duplicate found')
      return
    }

    console.log('Found duplicate at row:', duplicateRowIndex + 1)

    // Delete the duplicate row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: await getSheetId(APPROVED_EDITIONS_SHEET),
              dimension: 'ROWS',
              startIndex: duplicateRowIndex,
              endIndex: duplicateRowIndex + 1
            }
          }
        }]
      }
    })

    console.log('Successfully removed duplicate')
  } catch (error) {
    console.error('Error removing duplicate edition:', error)
    throw error
  }
}

async function addEditionToSheet(edition: any) {
  try {
    if (!edition || !edition.slug || !edition.slug.current || !edition.piece || !edition.piece.slug) {
      throw new Error('Invalid edition data: missing required fields')
    }

    console.log('Adding edition:', {
      pieceSlug: edition.piece.slug.current,
      editor: edition.editor,
      publisher: edition.publisher,
      copyright: edition.copyright,
      url: edition.url
    })

    // Remove any existing duplicate before adding
    await removeDuplicateEdition(edition.slug.current)

    const editionRow = [
      edition.piece.slug.current,  // Piece Slug
      edition.slug.current,        // Edition Slug
      edition.editor || '',        // Editor
      edition.publisher || '',     // Publisher
      edition.copyright || '',     // Copyright
      edition.url || '',           // URL
      new Date().toISOString(),    // Approval Date
    ]

    console.log('Appending edition row to sheet:', editionRow)

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${APPROVED_EDITIONS_SHEET}'!A:G`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [editionRow],
      },
    })

    if (!response.data) {
      throw new Error('No response data from sheets API')
    }

    console.log('Successfully added edition:', response.data)
    return response.data
  } catch (error) {
    console.error('Error adding edition:', error)
    if (error instanceof Error) {
      throw new Error(`Failed to add edition: ${error.message}`)
    }
    throw error
  }
}

async function removeEditionFromSheet(score: any) {
  try {
    const pieceSlug = createSlug(score.composerName, score.pieceName)
    console.log('Removing edition for piece:', {
      pieceSlug,
      scoreUrl: score.scoreUrl,
    })

    // Get all values from the editions sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${APPROVED_EDITIONS_SHEET}'!A:F`,
    })

    const values = response.data.values || []
    console.log('Found', values.length, 'rows in editions sheet')
    
    // Find the row index that matches both the piece slug and score URL
    const rowIndex = values.findIndex(row => row[0] === pieceSlug && row[4] === score.scoreUrl)
    console.log('Found matching edition at index:', rowIndex)
    
    if (rowIndex === -1) {
      console.log('No matching edition found, skipping deletion')
      return
    }

    const sheetId = await getSheetId(APPROVED_EDITIONS_SHEET)
    console.log('Retrieved editions sheet ID:', sheetId)

    // Delete the row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
          },
        }],
      },
    })
    console.log('Edition removed successfully')
  } catch (error) {
    console.error('Error removing edition:', error)
    throw error
  }
}

async function cleanupDuplicatePieces() {
  try {
    console.log('Starting duplicate piece cleanup')
    
    // Get all pieces
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PIECES_SHEET}'!A:E`,
    })

    if (!response.data.values) {
      console.log('No values found in sheet')
      return
    }

    const allRows = response.data.values
    const header = allRows[0]
    const rows = allRows.slice(1)

    // Track unique slugs and their first occurrence
    const slugMap = new Map<string, number>()
    const duplicateRows: number[] = []

    rows.forEach((row, index) => {
      const slug = row[0] as string
      if (!slugMap.has(slug)) {
        slugMap.set(slug, index + 2) // +2 for 1-based index and header
      } else {
        duplicateRows.push(index + 2)
      }
    })

    if (duplicateRows.length === 0) {
      console.log('No duplicate pieces found')
      return
    }

    console.log('Found duplicate rows:', duplicateRows)

    // Get sheet ID for deletion
    const sheetId = await getSheetId(PIECES_SHEET)

    // Delete duplicate rows in reverse order to maintain correct indices
    const sortedDuplicates = duplicateRows.sort((a, b) => b - a)
    
    for (const rowIndex of sortedDuplicates) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex - 1, // Convert to 0-based index
                endIndex: rowIndex // endIndex is exclusive
              }
            }
          }]
        }
      })
      console.log('Deleted duplicate row:', rowIndex)
    }

    console.log('Cleanup completed, removed', duplicateRows.length, 'duplicate pieces')
  } catch (error) {
    console.error('Error during duplicate cleanup:', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, data } = body

    if (!action || !data) {
      return NextResponse.json({ error: 'Missing required fields: action and data' }, { status: 400 })
    }

    console.log('Received request:', { 
      action, 
      data: { 
        type: data._type,
        id: data._id
      }
    })

    // Ensure both sheets exist with correct headers
    await ensureSheetExists(PIECES_SHEET, ['Slug', 'Piece Title', 'Composer', 'Year', 'Era', 'Summary'])
    await ensureSheetExists(APPROVED_EDITIONS_SHEET, ['Piece Slug', 'Edition Slug', 'Editor', 'Publisher', 'Copyright', 'URL', 'Approval Date'])

    // Process actions through the queue
    if (action === 'add_piece') {
      try {
        await approvalQueue.add(async () => {
          await addPieceToSheet(data)
        })
      } catch (error) {
        console.error('Error in add_piece action:', error)
        return NextResponse.json({ 
          error: 'Failed to add piece to sheet',
          details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 })
      }
    } else if (action === 'add_edition') {
      try {
        await approvalQueue.add(async () => {
          await addEditionToSheet(data)
        })
      } catch (error) {
        console.error('Error in add_edition action:', error)
        return NextResponse.json({ 
          error: 'Failed to add edition to sheet',
          details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 })
      }
    } else if (action === 'remove_edition') {
      try {
        await approvalQueue.add(async () => {
          await removeDuplicateEdition(data.slug.current)
        })
      } catch (error) {
        console.error('Error in remove_edition action:', error)
        return NextResponse.json({ 
          error: 'Failed to remove edition from sheet',
          details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 })
      }
    } else {
      console.error('Invalid action:', action)
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    console.log('Operation completed successfully')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Sheets API error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ 
      error: 'Failed to update sheet',
      details: errorMessage
    }, { status: 500 })
  }
} 