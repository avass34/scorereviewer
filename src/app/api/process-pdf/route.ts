import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import chromium from '@sparticuz/chromium-min'
import puppeteer from 'puppeteer-core'

const BUCKET_NAME = 'tonebase-emails'
const REGION = 'us-east-1'
const APPROVED_PREFIX = 'Q2_2021/Q2W4/Scores/general'

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

export const runtime = 'edge'
export const preferredRegion = 'iad1' // Use US East region for better IMSLP access

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

    // Launch browser with Sparticuz Chromium
    logWithTimestamp('Launching browser with Sparticuz Chromium')
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
      ignoreHTTPSErrors: true
    })
    logWithTimestamp('Browser launched successfully')

    try {
      // Create new page and handle navigation
      const page = await browser.newPage()
      logWithTimestamp('New browser page created')
      
      // Set viewport and user agent
      await page.setViewport({ width: 1280, height: 800 })
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')
      logWithTimestamp('Page configuration set', { viewport: '1280x800' })

      // Enable request/response logging
      page.on('request', request => {
        logWithTimestamp('Page request', {
          url: request.url(),
          method: request.method(),
          resourceType: request.resourceType()
        })
      })

      page.on('response', response => {
        logWithTimestamp('Page response', {
          url: response.url(),
          status: response.status(),
          headers: response.headers()
        })
      })

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
      
      // I understand, continue
      // Click here to continue your download.
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

      // Function to check for download link
      const checkForDownloadLink = async () => {
        const downloadSelectors = [
          'a[href*=".pdf"]:not([style*="display: none"])',
          'a:has-text("Click here")',
          'a:has-text("Download")',
          'a[href*="download"]'
        ]
        
        for (const selector of downloadSelectors) {
          logWithTimestamp('Checking selector', { selector })
          const element = await page.$(selector)
          if (element) {
            const isVisible = await element.isVisible()
            if (isVisible) {
              logWithTimestamp('Found visible download link', { selector })
              return element
            }
          }
        }
        return null
      }

      // Wait for download link with periodic checks
      logWithTimestamp('Starting periodic checks for download link')
      let downloadLink = null
      const maxAttempts = 20
      for (let i = 0; i < maxAttempts; i++) {
        logWithTimestamp('Download link check attempt', { attempt: i + 1, maxAttempts })
        downloadLink = await checkForDownloadLink()
        if (downloadLink) {
          logWithTimestamp('Download link found', { attempt: i + 1 })
          break
        }
        await page.waitForTimeout(1000)
      }

      if (!downloadLink) {
        logWithTimestamp('Failed to find download link after all attempts')
        throw new Error('Could not find download link after waiting')
      }

      // Get the href attribute using evaluate with proper type assertion
      const pdfUrl = await downloadLink.evaluate((el: Element) => {
        const anchor = el as HTMLAnchorElement
        return anchor.href
      })
      logWithTimestamp('Extracted PDF URL', { pdfUrl })

      // Navigate to PDF URL
      logWithTimestamp('Downloading PDF', { url: pdfUrl })
      const pdfResponse = await page.goto(pdfUrl, { 
        waitUntil: 'networkidle0',
        timeout: 30000 
      })
      
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

    } finally {
      // Always close the browser
      if (browser) {
        logWithTimestamp('Closing browser')
        await browser.close()
        logWithTimestamp('Browser closed')
      }
    }

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
  }
} 