import { generateReadingTime } from './helpers'
const toc = require('markdown-toc')

// Payload API configuration
const PAYLOAD_URL = process.env.NEXT_PUBLIC_CMS_URL || 'http://localhost:3030'
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY

// Debug logging for environment variables
console.log('[cms-posts] PAYLOAD_URL:', PAYLOAD_URL)
console.log('[cms-posts] PAYLOAD_API_KEY exists:', !!PAYLOAD_API_KEY)
console.log('[cms-posts] Environment:', {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_CMS_URL: process.env.NEXT_PUBLIC_CMS_URL,
})

type CMSBlogPost = {
  id: string
  title: string
  slug: string
  description: string
  content: {
    root: {
      children: Array<{
        type: string
        children: Array<{
          text: string
          type: string
          [key: string]: any
        }>
        [key: string]: any
      }>
    }
  }
  date?: string
  launchweek?: string
  toc_depth?: number
  readingTime?: number
  tags?: string[]
  industry?: string[]
  supabase_products?: string[]
  company_size?: string
  region?: string
  logo?: string
  logo_inverse?: string
  thumb?: {
    url: string
  }
  image?: {
    url: string
  }
  createdAt: string
  updatedAt: string
  authors?: {
    author: string
    author_id: string
    position: string
    author_url: string
    author_image_url: {
      url: string
    }
    username: string
  }[]
}

type ProcessedPost = {
  slug: string
  title: string
  description: string
  date: string
  formattedDate: string
  readingTime: string
  industry?: string[]
  supabase_products?: string[]
  company_size?: string
  region?: string
  logo?: string
  logo_inverse?: string
  authors: Array<{
    author: string
    author_id: string
    position: string
    author_url: string
    author_image_url: string | null
    username: string
  }>
  toc_depth: number
  thumb: string | null
  image: string | null
  url: string
  path: string
  isCMS: boolean
  tags: string[]
  content: string
}

/**
 * Convert Payload rich text content to markdown
 */
function convertRichTextToMarkdown(content: CMSBlogPost['content']): string {
  if (!content?.root?.children) return ''

  return content.root.children
    .map((node) => {
      if (node.type === 'heading') {
        const level = node.tag?.replace('h', '') || '1'
        const text = node.children?.map((child) => child.text).join('') || ''
        return `${'#'.repeat(Number(level))} ${text}`
      }
      if (node.type === 'paragraph') {
        return node.children?.map((child) => child.text).join('') || ''
      }
      if (node.type === 'list') {
        const items = node.children
          ?.map((item) => {
            if (item.type === 'list-item') {
              return `- ${item.children?.map((child: { text: any }) => child.text).join('') || ''}`
            }
            return ''
          })
          .filter(Boolean)
          .join('\n')
        return items
      }
      if (node.type === 'link') {
        const text = node.children?.map((child) => child.text).join('') || ''
        const url = node.url || ''
        return `[${text}](${url})`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Fetch all blog post slugs from the CMS
 */
export async function getAllCMSPostSlugs() {
  try {
    const response = await fetch(
      `${PAYLOAD_URL}/api/posts?limit=100&depth=1&draft=false&where[_status][equals]=published`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(PAYLOAD_API_KEY && { Authorization: `Bearer ${PAYLOAD_API_KEY}` }),
        },
      }
    )

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    console.log(
      '[getAllCMSPostSlugs] Found posts:',
      data.docs.map((post: any) => ({
        id: post.id,
        title: post.title,
        slug: post.slug,
        status: post._status,
      }))
    )

    return data.docs
      .filter((post: CMSBlogPost) => post.slug) // Filter out posts with null/undefined slugs
      .map((post: CMSBlogPost) => ({
        params: {
          slug: post.slug,
        },
      }))
  } catch (error) {
    console.error('Error fetching CMS post slugs:', error)
    return []
  }
}

/**
 * Fetch a single blog post from the CMS by slug
 */
export async function getCMSPostBySlug(slug: string, preview = false) {
  console.log(
    `[getCMSPostBySlug] Fetching post '${slug}', preview: ${preview}, from ${PAYLOAD_URL}`
  )

  try {
    // When in preview mode, specify draft=true to get the latest draft content
    const url = `${PAYLOAD_URL}/api/posts?where[slug][equals]=${slug}&depth=2${preview ? '&draft=true' : ''}`
    console.log(`[getCMSPostBySlug] API URL: ${url}`)

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(PAYLOAD_API_KEY && { Authorization: `Bearer ${PAYLOAD_API_KEY}` }),
      },
      // Important: don't cache draft content
      cache: preview ? 'no-store' : 'default',
      // Add timestamp to prevent caching in preview mode
      ...(preview && {
        next: { revalidate: 0 },
      }),
    })

    if (!response.ok) {
      console.error(`[getCMSPostBySlug] HTTP error: ${response.status} ${response.statusText}`)
      const errorText = await response.text()
      console.error(`[getCMSPostBySlug] Error response body:`, errorText)
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    console.log(
      `[getCMSPostBySlug] API responded with ${data.docs?.length || 0} posts, draft mode: ${preview}`
    )
    console.log(`[getCMSPostBySlug] Full API response:`, JSON.stringify(data, null, 2))

    // In preview mode, we want to return the draft even if it's not published
    if (!data.docs.length && !preview) {
      console.log(`[getCMSPostBySlug] No docs found, not in preview mode, returning null`)
      console.log(`[getCMSPostBySlug] Slug searched: '${slug}'`)
      return null
    }

    // If we're in preview mode and there's no draft, try to get the published version
    if (!data.docs.length && preview) {
      console.log(`[getCMSPostBySlug] No draft found but in preview mode, trying published version`)
      console.log(`[getCMSPostBySlug] Slug searched: '${slug}'`)
      const publishedUrl = `${PAYLOAD_URL}/api/posts?where[slug][equals]=${slug}&depth=2`
      console.log(`[getCMSPostBySlug] Published API URL: ${publishedUrl}`)

      const publishedResponse = await fetch(publishedUrl, {
        headers: {
          'Content-Type': 'application/json',
          ...(PAYLOAD_API_KEY && { Authorization: `Bearer ${PAYLOAD_API_KEY}` }),
        },
      })

      if (!publishedResponse.ok) {
        console.error(
          `[getCMSPostBySlug] HTTP error for published version: ${publishedResponse.status}`
        )
        throw new Error(`HTTP error! status: ${publishedResponse.status}`)
      }

      const publishedData = await publishedResponse.json()
      console.log(
        `[getCMSPostBySlug] Published API responded with ${publishedData.docs?.length || 0} posts`
      )

      if (!publishedData.docs.length) {
        console.log(`[getCMSPostBySlug] No published version found either, returning null`)
        console.log(
          `[getCMSPostBySlug] Slug searched: '${slug}', preview: ${preview}, PAYLOAD_URL: ${PAYLOAD_URL}`
        )
        return null
      }

      console.log(`[getCMSPostBySlug] Found published version, returning that instead of draft`)
      return processPostData(publishedData.docs[0])
    }

    console.log(`[getCMSPostBySlug] Found ${preview ? 'draft' : 'published'} post, processing data`)

    // If we have a post (either draft or published), process it
    const post = data.docs[0]

    // Let's log some key data to ensure it's what we expect
    console.log(`[getCMSPostBySlug] Post title: ${post.title}`)
    console.log(`[getCMSPostBySlug] Post status: ${post._status || 'published'}`)
    console.log(`[getCMSPostBySlug] Post content type:`, typeof post.content)
    console.log(`[getCMSPostBySlug] Post slug: ${post.slug}`)
    console.log(`[getCMSPostBySlug] About to call processPostData...`)

    try {
      const processedPost = processPostData(post)
      console.log(`[getCMSPostBySlug] Successfully processed post:`, {
        slug: processedPost.slug,
        title: processedPost.title,
        isCMS: processedPost.isCMS,
      })
      return processedPost
    } catch (error) {
      console.error(`[getCMSPostBySlug] Error in processPostData:`, error)
      return null
    }
  } catch (error) {
    console.error('Error fetching CMS post by slug:', error)
    return null
  }
}

// Helper function to process post data
function processPostData(post: any) {
  console.log(`[processPostData] Starting to process post:`, {
    id: post.id,
    title: post.title,
    slug: post.slug,
    _status: post._status,
  })

  try {
    const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }
    const formattedDate = new Date(post.date || new Date()).toLocaleDateString('en-IN', options)

    console.log(`[processPostData] About to convert rich text to markdown...`)
    const markdownContent = convertRichTextToMarkdown(post.content)
    console.log(`[processPostData] Markdown conversion successful, length:`, markdownContent.length)

    const readingTime = post.readingTime || generateReadingTime(markdownContent)

    // Generate TOC from content for CMS blog posts
    const tocResult = toc(markdownContent, {
      maxdepth: post.toc_depth ? post.toc_depth : 2,
    })

    // Extract thumb and image URLs from the nested structure
    const thumbUrl = post.thumb?.url ? `${PAYLOAD_URL}${post.thumb.url}` : null
    const imageUrl = post.image?.url ? `${PAYLOAD_URL}${post.image.url}` : null

    console.log(`[processPostData] About to return processed data...`)
    const processedData = {
      slug: post.slug,
      source: markdownContent,
      title: post.title || 'Untitled Post',
      date: post.date || new Date().toISOString(),
      formattedDate,
      readingTime,
      launchweek: post.launchweek || null,
      authors:
        post.authors?.map((author: any) => ({
          author: author.author || 'Unknown Author',
          author_id: author.author_id || '',
          position: author.position || '',
          author_url: author.author_url || '#',
          author_image_url: author.author_image_url?.url
            ? author.author_image_url.url.includes('http')
              ? author.author_image_url?.url
              : `${PAYLOAD_URL}${author.author_image_url.url}`
            : null,
          username: author.username || '',
        })) || [],
      toc_depth: post.toc_depth || 2,
      thumb: thumbUrl,
      image: imageUrl,
      url: `/blog/${post.slug}`,
      path: `/blog/${post.slug}`,
      isCMS: true,
      content: markdownContent,
      richContent: post.content,
      tags: post.tags || [],
      toc: {
        content: tocResult.content.replace(/%23/g, ''),
        json: tocResult.json,
      },
    }

    console.log(`[processPostData] Successfully processed data for:`, processedData.title)
    return processedData
  } catch (error) {
    console.error(`[processPostData] Error processing post data:`, error)
    throw error
  }
}

/**
 * Fetch all blog posts from the CMS
 */
export async function getAllCMSPosts({
  limit,
  tags,
  currentPostSlug,
}: {
  limit?: number
  tags?: string[]
  currentPostSlug?: string
} = {}): Promise<ProcessedPost[]> {
  try {
    const response = await fetch(
      `${PAYLOAD_URL}/api/posts?depth=2&draft=false&where[_status][equals]=published`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(PAYLOAD_API_KEY && { Authorization: `Bearer ${PAYLOAD_API_KEY}` }),
        },
      }
    )

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()

    let posts = data.docs
      .filter((post: CMSBlogPost) => post.slug !== currentPostSlug)
      .map((post: CMSBlogPost) => {
        const options: Intl.DateTimeFormatOptions = {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }
        const formattedDate = new Date(post.date || new Date()).toLocaleDateString('en-IN', options)
        const markdownContent = convertRichTextToMarkdown(post.content)
        const readingTime = post.readingTime || generateReadingTime(markdownContent)

        // Extract thumb and image URLs from the nested structure (handle absolute and relative)
        const thumbUrl = post.thumb?.url
          ? post.thumb.url.includes('http')
            ? post.thumb.url
            : `${PAYLOAD_URL}${post.thumb.url}`
          : null
        const imageUrl = post.image?.url
          ? post.image.url.includes('http')
            ? post.image.url
            : `${PAYLOAD_URL}${post.image.url}`
          : null

        return {
          slug: post.slug || '',
          title: post.title || '',
          description: post.description || '',
          date: post.date || new Date().toISOString(),
          formattedDate,
          readingTime,
          authors:
            post.authors?.map((author: any) => ({
              author: author.author || '',
              author_id: author.author_id || '',
              position: author.position || '',
              author_url: author.author_url || '#',
              author_image_url: author.author_image_url?.url
                ? author.author_image_url.url.includes('http')
                  ? author.author_image_url.url
                  : `${PAYLOAD_URL}${author.author_image_url.url}`
                : null,
              username: author.username || '',
            })) || [],
          toc_depth: post.toc_depth || 2,
          thumb: thumbUrl,
          image: imageUrl,
          url: `/blog/${post.slug || ''}`,
          path: `/blog/${post.slug || ''}`,
          isCMS: true,
          tags: post.tags || [],
          content: markdownContent,
        }
      })

    // Sort by date (newest first)
    posts = posts.sort(
      (a: ProcessedPost, b: ProcessedPost) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    )

    // Filter by tags if provided
    if (tags && tags.length > 0) {
      posts = posts.filter((post: ProcessedPost) => {
        const found = tags.some((tag) => post.tags?.includes(tag))
        return found
      })
    }

    // Limit results if specified
    if (limit) {
      posts = posts.slice(0, limit)
    }

    return posts
  } catch (error) {
    console.error('Error fetching all CMS posts:', error)
    return []
  }
}
