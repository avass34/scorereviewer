import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  
  if (!url) {
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 })
  }

  try {
    // If it's an IMSLP ImagefromIndex URL, convert it to the direct PDF URL
    if (url.includes('imslp.org/wiki/Special:ImagefromIndex')) {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      })
      const text = await response.text()
      
      // Find the direct PDF link
      const pdfMatch = text.match(/href="(https:\/\/[^"]+\.pdf[^"]*)"/)
      if (pdfMatch && pdfMatch[1]) {
        const pdfUrl = pdfMatch[1]
        // Redirect to the PDF URL through our proxy
        const response = await fetch(pdfUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        })
        
        const blob = await response.blob()
        return new NextResponse(blob, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'inline',
          },
        })
      }
    }

    // For direct PDF URLs
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    })
    
    const contentType = response.headers.get('content-type')
    
    if (contentType?.includes('application/pdf')) {
      const blob = await response.blob()
      return new NextResponse(blob, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline',
        },
      })
    }
    
    // For HTML content (fallback)
    const text = await response.text()
    return new NextResponse(text, {
      headers: {
        'Content-Type': 'text/html',
      },
    })
  } catch (error) {
    console.error('Proxy error:', error)
    return NextResponse.json({ error: 'Failed to fetch content' }, { status: 500 })
  }
} 