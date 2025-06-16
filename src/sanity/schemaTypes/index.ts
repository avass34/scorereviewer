// Import all schema types
import {defineField, defineType} from 'sanity'

const piece = defineType({
  name: 'piece',
  title: 'Piece',
  type: 'document',
  fields: [
    defineField({
      name: 'piece_title',
      title: 'Piece Title',
      type: 'string',
    }),
    defineField({
      name: 'composer',
      title: 'Composer',
      type: 'string',
    }),
    defineField({
      name: 'year_of_composition',
      title: 'Year of Composition',
      type: 'number',
    }),
    defineField({
      name: 'era',
      title: 'Era',
      type: 'string',
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          {title: 'Unreviewed', value: 'unreviewed'},
          {title: 'Reviewed', value: 'reviewed'}
        ]
      },
      initialValue: 'unreviewed'
    })
  ]
})

const edition = defineType({
  name: 'edition',
  title: 'Edition',
  type: 'document',
  fields: [
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
    }),
    defineField({
      name: 'publisher',
      title: 'Publisher',
      type: 'string',
    }),
    defineField({
      name: 'copyright',
      title: 'Copyright',
      type: 'string',
    }),
    defineField({
      name: 'editor',
      title: 'Editor',
      type: 'string',
    }),
    defineField({
      name: 'url',
      title: 'URL',
      type: 'url',
    }),
    defineField({
      name: 'piece',
      title: 'Piece',
      type: 'reference',
      to: [{type: 'piece'}]
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          {title: 'Unreviewed', value: 'unreviewed'},
          {title: 'Approved', value: 'approved'},
          {title: 'Rejected', value: 'rejected'}
        ]
      },
      initialValue: 'unreviewed'
    }),
    defineField({
      name: 'rejectionReason',
      title: 'Rejection Reason',
      type: 'text',
    }),
    defineField({
      name: 'reviewedAt',
      title: 'Reviewed At',
      type: 'datetime',
    })
  ]
})

export const schemaTypes = [piece, edition]
