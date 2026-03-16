import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

const remarkPlugins = [remarkGfm]
const rehypePlugins = [rehypeHighlight]

export const Markdown = React.memo(function Markdown({ children, className = '' }) {
  return (
    <div className={`prose prose-sm prose-invert max-w-none ${className}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {children}
      </ReactMarkdown>
    </div>
  )
}, (prev, next) => prev.children === next.children && prev.className === next.className)
