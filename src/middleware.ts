import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Get the pathname of the request (e.g. /, /protected-page)
  const path = request.nextUrl.pathname

  // Define public paths that don't require authentication
  const isPublicPath = path === '/auth' || path.startsWith('/api/')

  // Check if the user is authenticated
  const isAuthenticated = request.cookies.has('auth')

  // If the path is public and user is authenticated,
  // redirect to review page instead of home
  if (isPublicPath && isAuthenticated) {
    return NextResponse.redirect(new URL('/review', request.url))
  }

  // If it's the root path, redirect to review page
  if (path === '/') {
    return NextResponse.redirect(new URL('/review', request.url))
  }

  // If the path is protected and user is not authenticated,
  // redirect to login page
  if (!isPublicPath && !isAuthenticated) {
    return NextResponse.redirect(new URL('/auth', request.url))
  }
}

// Configure the paths that middleware will run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
} 