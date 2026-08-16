import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// Bot avatar icon
function BotAvatar() {
  return (
    <div className="bot-avatar" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
        <circle cx="9" cy="15" r="1" fill="white" stroke="none"/>
        <circle cx="15" cy="15" r="1" fill="white" stroke="none"/>
      </svg>
    </div>
  );
}

// 3-dot typing indicator
function TypingIndicator() {
  return (
    <div className="typing-indicator" role="status" aria-label="AI is thinking">
      <div className="typing-dot" />
      <div className="typing-dot" />
      <div className="typing-dot" />
    </div>
  );
}

export default function MessageList({ messages, messagesEndRef, setInputValue }) {
  // Convert LaTeX delimiters for remark-math
  const preprocessMarkdown = (text) => {
    return text
      .replace(/\\\[/g, '$$$$')
      .replace(/\\\]/g, '$$$$')
      .replace(/\\\(/g, '$')
      .replace(/\\\)/g, '$');
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="messages" role="log" aria-live="polite" aria-label="Conversation">
      {/* Welcome / empty state */}
      {!hasMessages && (
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
              <circle cx="9" cy="15" r="1" fill="white" stroke="none"/>
              <circle cx="15" cy="15" r="1" fill="white" stroke="none"/>
            </svg>
          </div>
          <div>
            <h2>How can I help you today?</h2>
            <p>Ask anything, upload a PDF document, or switch to Blog mode to generate articles with AI.</p>
          </div>
          <div className="empty-state-suggestions" role="list" aria-label="Suggested prompts">
            {[
              'Summarize a document',
              'Explain a concept',
              'Write some code',
              'Analyze data',
            ].map((s) => (
              <button
                key={s}
                className="suggestion-chip"
                role="listitem"
                onClick={() => setInputValue?.(s)}
                aria-label={`Try: ${s}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message list */}
      {messages.map((msg, idx) => {
        if (msg.isSystem) {
          return (
            <div key={idx} className="message system-message" role="status">
              <div className="system-bubble">{msg.text}</div>
            </div>
          );
        }

        if (msg.sender === 'user') {
          return (
            <div key={idx} className="message user">
              <div className="bubble" role="article" aria-label="Your message">
                {msg.text}
              </div>
            </div>
          );
        }

        // Bot message
        return (
          <div key={idx} className="message bot">
            <div className="bot-row">
              <BotAvatar />
              <div className="bubble" role="article" aria-label="AI response">
                {msg.isThinking ? (
                  <TypingIndicator />
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      code({ inline, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        return !inline && match ? (
                          <SyntaxHighlighter
                            {...props}
                            style={vscDarkPlus}
                            language={match[1]}
                            PreTag="div"
                            customStyle={{
                              borderRadius: '10px',
                              fontSize: '0.85em',
                              margin: '0.75rem 0',
                            }}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code {...props} className={className}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {preprocessMarkdown(msg.text + (msg.isStreaming ? ' ▍' : ''))}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          </div>
        );
      })}

      <div ref={messagesEndRef} aria-hidden="true" />
    </div>
  );
}
