import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'

// Define error type for Google API errors
interface GoogleAPIError {
  response?: {
    status: number;
    statusText: string;
    data: any;
  };
  message: string;
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
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

console.log('Sheets API initialized with email:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL)

const sheets = google.sheets({ version: 'v4', auth })
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID
const SHEET_NAME = 'Approved Editions'

console.log('Using spreadsheet ID:', SPREADSHEET_ID)

// Cache for sheet ID
let sheetId: number | null = null

async function getSheetId() {
  if (sheetId !== null) return sheetId

  try {
    console.log('Fetching sheet ID for:', SHEET_NAME)
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    })

    console.log('Spreadsheet details:', {
      title: response.data.properties?.title,
      sheets: response.data.sheets?.map(s => s.properties?.title),
    })

    const sheet = response.data.sheets?.find(
      (s) => s.properties?.title === SHEET_NAME
    )

    if (!sheet?.properties?.sheetId) {
      console.error('Sheet not found in spreadsheet')
      throw new Error('Sheet not found')
    }

    sheetId = sheet.properties.sheetId
    console.log('Found sheet ID:', sheetId)
    return sheetId
  } catch (error) {
    console.error('Error getting sheet ID:', error)
    throw error
  }
}

async function addRowToSheet(score: any) {
  try {
    console.log('Adding row for score:', {
      pieceName: score.pieceName,
      composerName: score.composerName,
      status: score.status,
    })

    // Format the row data
    const row = [
      score.pieceName,        // Piece Name
      score.composerName,     // Composer
      score.editor,           // Editor
      score.publisher,        // Publisher
      score.language,         // Language
      score.copyright,        // Copyright
      score.scoreUrl,         // Score URL
      new Date().toISOString(), // Approval Date
    ]

    console.log('Formatted row data:', row)

    // First ensure the sheet exists and headers are set
    let sheetExists = false
    try {
      console.log('Checking if sheet exists...')
      const headerResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A1:H1`,
      })
      sheetExists = true
      console.log('Sheet exists, headers:', headerResponse.data.values?.[0])
    } catch (error) {
      console.log('Sheet does not exist, will create it')
    }

    if (!sheetExists) {
      try {
        console.log('Creating new sheet...')
        const createResponse = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: SHEET_NAME,
                  },
                },
              },
            ],
          },
        })
        console.log('Sheet created:', createResponse.data)

        const headers = [
          'Piece Name',
          'Composer',
          'Editor',
          'Publisher',
          'Language',
          'Copyright',
          'Score URL',
          'Approval Date'
        ]

        console.log('Adding headers:', headers)
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${SHEET_NAME}'!A1:H1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [headers],
          },
        })
        console.log('Headers added successfully')
      } catch (createError) {
        console.error('Error creating sheet:', createError)
        throw createError
      }
    }

    console.log('Appending row to sheet...')
    // Append the row
    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A:H`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [row],
      },
    })
    console.log('Row appended successfully:', appendResponse.data)
  } catch (error) {
    console.error('Error adding row to sheet:', error)
    const apiError = error as GoogleAPIError
    if (apiError.response) {
      console.error('Error response:', {
        status: apiError.response.status,
        statusText: apiError.response.statusText,
        data: apiError.response.data,
      })
    }
    throw error
  }
}

async function removeRowFromSheet(score: any) {
  try {
    console.log('Removing row for score:', {
      pieceName: score.pieceName,
      composerName: score.composerName,
      scoreUrl: score.scoreUrl,
    })

    // Get all values from the sheet
    console.log('Fetching current sheet values...')
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A:H`,
    })

    const values = response.data.values || []
    console.log('Found', values.length, 'rows in sheet')
    
    // Find the row index that matches the score URL
    const rowIndex = values.findIndex(row => row[6] === score.scoreUrl)
    console.log('Found matching row at index:', rowIndex)
    
    if (rowIndex === -1) {
      console.log('No matching row found, skipping deletion')
      return
    }

    const sheetId = await getSheetId()
    console.log('Retrieved sheet ID:', sheetId)

    console.log('Deleting row...')
    // Delete the row
    const deleteResponse = await sheets.spreadsheets.batchUpdate({
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
    console.log('Row deleted successfully:', deleteResponse.data)
  } catch (error) {
    console.error('Error removing row from sheet:', error)
    const apiError = error as GoogleAPIError
    if (apiError.response) {
      console.error('Error response:', {
        status: apiError.response.status,
        statusText: apiError.response.statusText,
        data: apiError.response.data,
      })
    }
    throw error
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, score } = body

    console.log('Received request:', { 
      action, 
      score: { 
        pieceName: score.pieceName,
        composerName: score.composerName,
        status: score.status,
      }
    })

    switch (action) {
      case 'add':
        await addRowToSheet(score)
        break
      case 'remove':
        await removeRowFromSheet(score)
        break
      default:
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