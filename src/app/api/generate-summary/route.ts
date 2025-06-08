import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

// Initialize the OpenAI client without an API key - it will use OPENAI_API_KEY from env
const openai = new OpenAI()

// Example summaries for context
const EXAMPLE_SUMMARIES = [
  {
    piece: "Symphony No. 5 in C minor",
    composer: "Ludwig van Beethoven",
    summary: "Beethoven’s Symphony No. 5 in C Minor unfolds as a dramatic four-movement arc that compresses his late Classical style into a tightly knit thematic journey. The iconic “fate” motif, a terse four-note gesture, serves as a unifying germ cell, threading through relentless rhythmic drive, motivic transformation, and key relationships, culminating in a triumphant C major finale that redefines symphonic trajectory and structural cohesion."
  },
  {
    piece: "The Rite of Spring",
    composer: "Igor Stravinsky",
    summary: "Stravinsky’s The Rite of Spring is a ferociously visceral score depicting pagan rites through stratified polyrhythms, shifting accents, and abrasive orchestral coloration. The composer disrupts both metric regularity and tonal expectations, employing ostinatos, additive rhythms, and bitonality to forge a primal sound world that reorients modernism and shattered ballet’s traditional narrative and sonic balance."
  },
  {
    piece: "Clair de Lune",
    composer: "Claude Debussy",
    summary: "Debussy’s Clair de Lune is an étude in tonal subtlety and timbral nuance, where fluid arpeggiations and parallel harmony evoke moonlight’s ephemeral shimmer. He crafts a modal-infused A-B-A form that centers on expressive rubato and soft dynamic coloring, laying the groundwork for the impressionist piano tradition through refined harmonic palettes and atmospheric intent."
  }
]

export async function POST(request: NextRequest) {
  try {
    const { pieceName, composerName } = await request.json()

    if (!pieceName || !composerName) {
      return NextResponse.json({ error: 'Piece name and composer name are required' }, { status: 400 })
    }

    const prompt = `Please write a two-sentence summary of "${pieceName}" by ${composerName}. The summary should be informative and engaging, similar to these examples:

${EXAMPLE_SUMMARIES.map(ex => `For "${ex.piece}" by ${ex.composer}: ${ex.summary}`).join('\n\n')}

Now, please provide a similar two-sentence summary for "${pieceName}" by ${composerName}:`

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a knowledgeable music historian tasked with writing concise, informative summaries of musical pieces. Focus on the piece's historical significance, musical characteristics, and cultural impact. Make sure to name the piece and the composer in your summary in the first sentence, with the piece title in italics not in quotes."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 200,
    })

    const summary = completion.choices[0]?.message?.content?.trim()

    if (!summary) {
      throw new Error('Failed to generate summary')
    }

    return NextResponse.json({ summary })
  } catch (error) {
    console.error('Error generating summary:', error)
    return NextResponse.json({ error: 'Failed to generate summary' }, { status: 500 })
  }
} 