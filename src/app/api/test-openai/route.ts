import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI()

export async function GET(request: NextRequest) {
  try {
    console.log('Testing OpenAI API connection...')
    console.log('API Key present:', !!process.env.OPENAI_API_KEY)
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: "Say 'OpenAI API is working!'"
        }
      ],
      max_tokens: 20,
    })

    console.log('OpenAI API response:', completion.choices[0]?.message?.content)
    
    return NextResponse.json({ 
      success: true,
      message: completion.choices[0]?.message?.content 
    })
  } catch (error) {
    console.error('OpenAI API test failed:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
} 