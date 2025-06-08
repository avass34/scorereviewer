import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import chromium from '@sparticuz/chromium-min'
import puppeteer from 'puppeteer-core'

const BUCKET_NAME = 'tonebase-emails'
const REGION = 'us-east-1'
const APPROVED_PREFIX = 'Q2_2021/Q2W4/Scores/general'

interface ProcessPdfResponse {
  success: boolean;
  url: string;
}

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

    // Initialize Chrome binary
    logWithTimestamp('Initializing Chrome binary')
    const executablePath = await chromium.executablePath()

    // Launch browser with appropriate configuration
    logWithTimestamp('Launching browser')
    const isVercel = process.env.VERCEL === '1'
    
    const launchOptions = {
      args: [
        ...chromium.args,
        '--autoplay-policy=user-gesture-required',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-dev-shm-usage',
        '--disable-domain-reliability',
        '--disable-extensions',
        '--disable-features=AudioServiceOutOfProcess',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-notifications',
        '--disable-offer-store-unmasked-wallet-cards',
        '--disable-popup-blocking',
        '--disable-print-preview',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-setuid-sandbox',
        '--disable-speech-api',
        '--disable-sync',
        '--hide-scrollbars',
        '--ignore-gpu-blacklist',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-first-run',
        '--no-pings',
        '--no-sandbox',
        '--no-zygote',
        '--password-store=basic',
        '--use-gl=swiftshader',
        '--use-mock-keychain',
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: true,
      ignoreHTTPSErrors: true,
      cacheDirectory: '/tmp'
    }

    logWithTimestamp('Browser launch options:', launchOptions)
    browser = await puppeteer.launch(launchOptions)
    logWithTimestamp('Browser launched successfully')

    const page = await browser.newPage()
    logWithTimestamp('New browser page created')
    
    await page.setViewport({ width: 1280, height: 800 })
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')
    logWithTimestamp('Page configuration set', { viewport: '1280x800' })

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
      logWithTimestamp('Closing browser')
      await browser.close()
      logWithTimestamp('Browser closed')
    }
  }
} 