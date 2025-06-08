import { type SchemaTypeDefinition, defineField, defineType } from 'sanity'
import { type SanityDocument } from '@sanity/client'
import { ScoreStatus } from '@/types/score'

const score = defineType({
  name: 'score',
  title: 'Score',
  type: 'document',
  fields: [
    defineField({
      name: 'pieceName',
      title: 'Piece Name',
      type: 'string',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'composerName',
      title: 'Composer Name',
      type: 'string',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {
        source: (doc: SanityDocument & { pieceName?: string; composerName?: string }) => 
          doc.pieceName && doc.composerName 
            ? `${doc.pieceName}-${doc.composerName}`.toLowerCase()
            : 'untitled',
        maxLength: 96,
      },
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'scoreUrl',
      title: 'Score URL',
      type: 'url',
      description: 'S3 URL of the score PDF',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'editor',
      title: 'Editor',
      type: 'string',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'publisher',
      title: 'Publisher',
      type: 'string',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'language',
      title: 'Language',
      type: 'string',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'copyright',
      title: 'Copyright',
      type: 'string',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'summary',
      title: 'Summary',
      type: 'text',
      description: 'AI-generated summary of the piece',
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Unreviewed', value: 'unreviewed' },
          { title: 'Approved', value: 'approved' },
          { title: 'Rejected', value: 'rejected' },
        ] as Array<{ title: string; value: ScoreStatus }>,
      },
      initialValue: 'unreviewed' as ScoreStatus,
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'rejectionReason',
      title: 'Rejection Reason',
      type: 'text',
      hidden: ({ document }) => (document?.status as ScoreStatus) !== 'rejected',
    }),
    defineField({
      name: 'reviewedAt',
      title: 'Reviewed At',
      type: 'datetime',
    }),
  ],
})

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [score],
} 