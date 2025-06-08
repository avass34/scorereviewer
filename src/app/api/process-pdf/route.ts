import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import puppeteer from 'puppeteer-core'

const BUCKET_NAME = 'tonebase-emails'
const REGION = 'us-east-1'
const APPROVED_PREFIX = 'Q2_2021/Q2W4/Scores/general'

// Example of properly formatted cookies:
const EXAMPLE_COOKIES = [
  {
    name: '_clck',
    value: '14225r1%7C2%7Cfwl%7C0%7C1985',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: '_clsk',
    value: 'c9yosg%7C1749354226036%7C3%7C0%7Ck.clarity.ms%2Fcollect',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: '_ga',
    value: 'GA1.2.1307290984.1749354194',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: '_ga_8370FT5CWW',
    value: 'GS2.2.s1749354194$o1$g1$t1749354226$j28$l0$h0',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: '_gid',
    value: 'GA1.2.1583301422.1749354195',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'BOT_DETECT_CLEARED',
    value: '3',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'CLID',
    value: 'c949bcbddbd649bba166a5e6dd721b3d.20250608.20260608',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'imslp_wiki_session',
    value: 'fd9f4069110a35df487b8f84b31f2ea4',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'imslp_wikiLanguageSelectorLanguage',
    value: 'en',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'imslp_wikiToken',
    value: '7ff80c7561e2c2c50ec8066b417791a7',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'imslp_wikiUserID',
    value: '479878',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'imslp_wikiUserName',
    value: 'Aidan1',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'mc',
    value: '684506d1-d1462-8a317-eb6ef',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'MUID',
    value: '31965B4902256FC036D94E3F03DE6E5F',
    domain: '.imslp.org',
    path: '/'
  }
]

// Helper function for consistent logging
function logWithTimestamp(message: string, data?: any) {
  const timestamp = new Date().toISOString()
  const logMessage = data 
    ? `[${timestamp}] ${message} ${JSON.stringify(data, null, 2)}`
    : `[${timestamp}] ${message}`
  console.log(logMessage)
}

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

// Get browser connection based on environment
async function getBrowser() {
  const isDev = process.env.NODE_ENV === 'development'
  
  if (isDev) {
    // In development, connect to local Chrome instance
    return await puppeteer.connect({
      browserURL: 'http://localhost:9222',
      defaultViewport: null,
    })
  } else {
    // In production, use Browserless.io
    if (!process.env.BROWSERLESS_API_KEY) {
      throw new Error('BROWSERLESS_API_KEY is required in production')
    }
    
    return await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`,
      defaultViewport: null,
    })
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  let browser;

  try {
    const { scoreUrl, slug } = await request.json()
    logWithTimestamp('PDF processing request received', { scoreUrl, slug })

    if (!scoreUrl || !slug) {
      logWithTimestamp('Missing required parameters', { scoreUrl, slug })
      return NextResponse.json({ 
        error: 'Missing required parameters' 
      }, { status: 400 })
    }

    // Get browser instance based on environment
    browser = await getBrowser()
    logWithTimestamp('Browser connection established')

    // Create a new page in the browser
    const page = await browser.newPage()
    logWithTimestamp('New browser page created')

    // Set cookies if available (can be stored in environment variables or database)
    if (process.env.IMSLP_COOKIES) {
      const cookies = JSON.parse(process.env.IMSLP_COOKIES)
      await page.setCookie(...cookies)
      logWithTimestamp('Cookies set from environment')
    }

    // Navigate to IMSLP page
    logWithTimestamp('Navigating to IMSLP page', { url: scoreUrl })
    const response = await page.goto(scoreUrl, { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    })

    if (!response) {
      logWithTimestamp('Failed to get response from IMSLP page')
      throw new Error('Failed to get response from IMSLP page')
    }

    // Check if we got a PDF directly
    const contentType = response.headers()['content-type'] || ''
    logWithTimestamp('Response content type', { contentType })

    if (contentType.includes('application/pdf')) {
      logWithTimestamp('Direct PDF response received')
      const pdfBuffer = await response.buffer()
      logWithTimestamp('PDF downloaded directly', { size: pdfBuffer.byteLength })
      
      // Upload to S3
      const fileName = `${slug}.pdf`
      const newKey = `${APPROVED_PREFIX}/${fileName}`
      logWithTimestamp('Uploading PDF to S3', { bucket: BUCKET_NAME, key: newKey })
      
      await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: newKey,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      }))
      logWithTimestamp('S3 upload successful')
      
      const newUrl = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${newKey}`
      logWithTimestamp('Processing completed successfully', { 
        duration: Date.now() - startTime,
        newUrl 
      })

      return NextResponse.json({ 
        success: true,
        url: newUrl
      })
    }

    // Handle IMSLP download page
    logWithTimestamp('Handling IMSLP download page')
    
    try {
      logWithTimestamp('Looking for "I understand" button')
      const understandButton = await page.waitForSelector('button:has-text("I understand")', { timeout: 5000 })
      if (understandButton) {
        logWithTimestamp('"I understand" button found, clicking')
        await understandButton.click()
        await page.waitForTimeout(1000)
        logWithTimestamp('"I understand" button clicked')
      }
    } catch (e) {
      logWithTimestamp('No immediate "I understand" button found')
    }

    // Look for the download link
    logWithTimestamp('Looking for download link')
    const downloadLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'))
      return links.find(link => 
        link.href?.includes('.pdf') || 
        link.getAttribute('data-id')?.includes('.pdf')
      )?.href
    })

    if (!downloadLink) {
      logWithTimestamp('No download link found')
      throw new Error('No download link found')
    }

    logWithTimestamp('Found download link', { url: downloadLink })

    // Download the PDF
    logWithTimestamp('Downloading PDF')
    const pdfResponse = await page.goto(downloadLink, { waitUntil: 'networkidle0' })

    if (!pdfResponse) {
      logWithTimestamp('Failed to download PDF')
      throw new Error('Failed to download PDF')
    }

    const pdfBuffer = await pdfResponse.buffer()
    logWithTimestamp('PDF downloaded', { size: pdfBuffer.byteLength })

    // Generate S3 key and upload
    const fileName = `${slug}.pdf`
    const newKey = `${APPROVED_PREFIX}/${fileName}`
    logWithTimestamp('Generated S3 path', {
      bucket: BUCKET_NAME,
      key: newKey
    })

    // Upload to S3
    logWithTimestamp('Starting S3 upload')
    const uploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: newKey,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    })

    await s3Client.send(uploadCommand)
    logWithTimestamp('S3 upload successful')

    const newUrl = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${newKey}`
    logWithTimestamp('Processing completed successfully', { 
      duration: Date.now() - startTime,
      newUrl 
    })

    return NextResponse.json({ 
      success: true,
      url: newUrl
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorDetails = {
      message: errorMessage,
      type: error instanceof Error ? error.constructor.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      duration: Date.now() - startTime
    }
    
    logWithTimestamp('PDF processing error', errorDetails)
    
    return NextResponse.json({ 
      error: 'Failed to process PDF',
      details: errorDetails
    }, { status: 500 })
  } finally {
    if (browser) {
      logWithTimestamp('Disconnecting from browser')
      await browser.disconnect()
      logWithTimestamp('Browser disconnected')
    }
  }
} 