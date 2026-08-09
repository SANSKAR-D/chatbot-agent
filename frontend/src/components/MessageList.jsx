import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function MessageList({ messages, messagesEndRef }) {
  // Helper to convert LaTeX delimiters \[ \] and \( \) to $$ and $ for remark-math
  const preprocessMarkdown = (text) => {
    return text
      .replace(/\\\[/g, '$$$$')
      .replace(/\\\]/g, '$$$$')
      .replace(/\\\(/g, '$')
      .replace(/\\\)/g, '$');
  };

  return (
    <div className="messages">
      {messages.map((msg, idx) => (
        <div key={idx} className={`message ${msg.sender}`}>
          <div className="bubble">
            {msg.isThinking ? (
              <span className="thinking-text" />
            ) : msg.isSystem ? (
              <div style={{ fontStyle: 'italic', color: '#888' }}>
                {msg.text}
              </div>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  code({ inline, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '')
                    return !inline && match ? (
                      <SyntaxHighlighter
                        {...props}
                        style={vscDarkPlus}
                        language={match[1]}
                        PreTag="div"
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    ) : (
                      <code {...props} className={className}>
                        {children}
                      </code>
                    )
                  }
                }}
              >
                {preprocessMarkdown(msg.text + (msg.isStreaming ? ' █' : ''))}
              </ReactMarkdown>
            )}
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}
